//! On Google TV / Android TV: the same `Player` that mpv.rs gives the PC, but
//! played by the TV's own player (Media3, see ExoPlugin.kt). Rust asks the TV
//! player for its state four times a second and turns changes into the same
//! events mpv sends, so the rest of Scrappy doesn't need to know the difference.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::Wry;

pub enum Event {
    /// An observed property changed.
    Property(String, Value),
    /// The file is open and playing.
    FileLoaded,
    /// The current file ended. `eof` is true when it played to the end.
    EndFile { eof: bool, error: Option<String> },
    /// The player has closed.
    Shutdown,
}

static EXO: OnceLock<PluginHandle<Wry>> = OnceLock::new();

/// Registers the TV player (ExoPlugin.kt) with the app.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("exo")
        .setup(|_app, api| {
            let h = api.register_android_plugin("app.scrappy.player", "ExoPlugin")?;
            let _ = EXO.set(h);
            Ok(())
        })
        .build()
}

/// The video and audio formats this TV plays by itself (asked once).
pub fn caps() -> Value {
    static CAPS: OnceLock<Value> = OnceLock::new();
    CAPS.get_or_init(|| call("caps", json!({})).unwrap_or(Value::Null)).clone()
}

fn call(cmd: &str, args: Value) -> Result<Value, String> {
    let h = EXO.get().ok_or("The TV player isn't ready.")?;
    h.run_mobile_plugin::<Value>(cmd, args).map_err(|e| e.to_string())
}

fn control(what: &str, extra: Value) -> Result<(), String> {
    let mut a = json!({ "what": what });
    if let (Some(o), Value::Object(e)) = (a.as_object_mut(), extra) {
        o.extend(e);
    }
    call("control", a).map(|_| ())
}

struct Inner {
    alive: bool,
    /// Properties set before a file loads (start time) and the last known state.
    props: HashMap<String, Value>,
    /// Subtitle files to load with the next video.
    pending_subs: Vec<Value>,
    aspect: (bool, bool), // (panscan fill, keepaspect)
}

#[derive(Clone)]
pub struct Player(Arc<Mutex<Inner>>);

impl Player {
    pub fn create(
        _search_dirs: &[PathBuf],
        options: &[(&str, String)],
        _observe: &[&str],
        on_event: impl Fn(Event) + Send + 'static,
    ) -> Result<Player, String> {
        // Only the video player runs on the TV for now (music comes in a later build).
        if !options.iter().any(|(k, v)| *k == "force-window" && v == "yes") {
            return Err("This isn't available on the TV yet.".into());
        }
        let inner = Arc::new(Mutex::new(Inner { alive: true, props: HashMap::new(), pending_subs: vec![], aspect: (false, true) }));
        let me = Player(inner.clone());
        // Whatever the TV player did before this belongs to an older file.
        let base = call("state", json!({}))?["seq"].as_i64().unwrap_or(0);
        std::thread::spawn(move || watch(inner, base, on_event));
        Ok(me)
    }

    pub fn alive(&self) -> bool {
        self.0.lock().unwrap().alive
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        if !self.alive() {
            return Err("Player is closed.".into());
        }
        match args {
            ["loadfile", url, ..] => {
                let (start, subs) = {
                    let mut i = self.0.lock().unwrap();
                    let start = i.props.get("start").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                    (start, std::mem::take(&mut i.pending_subs))
                };
                call("open", json!({ "url": url, "start": start, "subs": subs })).map(|_| ())
            }
            ["sub-add", url, _flag, rest @ ..] => {
                let title = rest.first().copied().unwrap_or("");
                let lang = rest.get(1).copied().unwrap_or("");
                self.0.lock().unwrap().pending_subs.push(json!({ "url": url, "title": title, "lang": lang }));
                Ok(())
            }
            ["seek", secs, mode @ ..] => {
                let v: f64 = secs.parse().unwrap_or(0.0);
                // "absolute", "absolute+exact", "absolute+keyframes" are all a spot in the film; the rest are steps.
                let relative = mode.first().map(|m| !m.starts_with("absolute")).unwrap_or(true);
                control("seek", json!({ "value": v, "relative": relative }))
            }
            ["cycle", "pause"] => control("toggle", json!({})),
            ["stop"] => control("stop", json!({})),
            ["reset"] => control("reset", json!({})),
            ["quit"] => {
                let _ = control("stop", json!({}));
                self.0.lock().unwrap().alive = false;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let yes = value == "yes";
        match name {
            "pause" => control("pause", json!({ "on": yes })),
            "speed" => control("speed", json!({ "value": value.parse::<f64>().unwrap_or(1.0) })),
            "volume" => control("volume", json!({ "value": value.parse::<f64>().unwrap_or(100.0) })),
            "mute" => control("mute", json!({ "on": yes })),
            "sid" => control("track", json!({ "type": "sub", "id": value })),
            "aid" => control("track", json!({ "type": "audio", "id": value })),
            "sub-scale" => control("subScale", json!({ "value": value.parse::<f64>().unwrap_or(1.0) })),
            "panscan" | "keepaspect" => {
                let a = {
                    let mut i = self.0.lock().unwrap();
                    if name == "panscan" { i.aspect.0 = value.parse::<f64>().unwrap_or(0.0) > 0.5 } else { i.aspect.1 = value != "no" }
                    i.aspect
                };
                let mode = if !a.1 { "stretch" } else if a.0 { "fill" } else { "fit" };
                control("aspect", json!({ "value": mode }))
            }
            _ => {
                self.0.lock().unwrap().props.insert(name.to_string(), Value::String(value.to_string()));
                Ok(())
            }
        }
    }

    pub fn get_property(&self, name: &str) -> Value {
        self.0.lock().unwrap().props.get(name).cloned().unwrap_or(Value::Null)
    }

    pub fn quit(&self) {
        let _ = self.command(&["quit"]);
    }
}

/// Ask the TV player how it's doing and report anything that changed, like mpv does.
fn watch(inner: Arc<Mutex<Inner>>, base: i64, on_event: impl Fn(Event)) {
    let mut last: HashMap<&'static str, Value> = HashMap::new();
    let mut seen_seq = base;
    let mut loaded_seq = base;
    let mut ended_seq = base;
    loop {
        std::thread::sleep(Duration::from_millis(250));
        if !inner.lock().unwrap().alive {
            break;
        }
        let Ok(s) = call("state", json!({})) else { continue };
        let seq = s["seq"].as_i64().unwrap_or(0);
        if seq != seen_seq {
            // A new file: forget what we reported about the last one.
            seen_seq = seq;
            last.clear();
        }
        if let Some(err) = s["error"].as_str() {
            if ended_seq != seq {
                ended_seq = seq;
                on_event(Event::EndFile { eof: false, error: Some(err.to_string()) });
            }
            continue;
        }
        if seq > 0 && s["ready"].as_i64() == Some(seq) && loaded_seq != seq {
            loaded_seq = seq;
            on_event(Event::FileLoaded);
        }
        let props: [(&'static str, Value); 10] = [
            ("time-pos", s["pos"].clone()),
            ("duration", s["dur"].clone()),
            ("pause", s["paused"].clone()),
            ("paused-for-cache", s["buffering"].clone()),
            ("demuxer-cache-time", s["cached"].clone()),
            ("speed", s["speed"].clone()),
            ("volume", s["volume"].clone()),
            ("mute", s["mute"].clone()),
            ("vo-configured", s["video"].clone()),
            ("track-list", s["tracks"].clone()),
        ];
        for (name, v) in props {
            if v.is_null() || last.get(name) == Some(&v) {
                continue;
            }
            last.insert(name, v.clone());
            inner.lock().unwrap().props.insert(name.to_string(), v.clone());
            on_event(Event::Property(name.to_string(), v));
        }
        if s["ended"].as_bool() == Some(true) && ended_seq != seq && loaded_seq == seq {
            ended_seq = seq;
            on_event(Event::EndFile { eof: true, error: None });
        }
    }
    on_event(Event::Shutdown);
}
