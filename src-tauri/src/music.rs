//! Music playback (Navidrome). A second, audio-only mpv that never opens a
//! window, so music keeps going while you browse and never fights the video player.
//!
//! mpv's own playlist holds the current song plus everything after it, which
//! gives gapless playback. The page keeps the full queue (and what came before).

use crate::{mpv, servers, AppState};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const OBSERVED: &[&str] = &[
    "time-pos", "duration", "pause", "volume", "mute", "playlist-pos", "playlist-count",
    "core-idle", "idle-active", "paused-for-cache",
];

fn on_event(app: &AppHandle, id: usize, last_emit: &Mutex<std::time::Instant>, ev: mpv::Event) {
    match ev {
        mpv::Event::Property(name, value) => {
            if name == "time-pos" {
                let mut last = last_emit.lock().unwrap();
                if last.elapsed().as_millis() < 250 {
                    return;
                }
                *last = std::time::Instant::now();
            }
            let _ = app.emit("music-prop", json!({ "name": name, "value": value }));
        }
        mpv::Event::FileLoaded => {
            let _ = app.emit("music-loaded", json!({}));
        }
        mpv::Event::EndFile { eof, error } => {
            let _ = app.emit("music-end", json!({ "eof": eof, "error": error }));
        }
        mpv::Event::Shutdown => {
            let state = app.state::<AppState>();
            let mut m = state.music.lock().unwrap();
            if m.as_ref().map(|(i, _)| *i == id).unwrap_or(false) {
                *m = None;
            }
            drop(m);
            let _ = app.emit("music-closed", json!({}));
        }
    }
}

fn ensure(app: &AppHandle) -> Result<mpv::Player, String> {
    let state = app.state::<AppState>();
    {
        let m = state.music.lock().unwrap();
        if let Some((_, p)) = m.as_ref() {
            if p.alive() {
                return Ok(p.clone());
            }
        }
    }
    let opts: Vec<(&str, String)> = vec![
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("idle", "yes".into()),
        ("video", "no".into()),
        ("force-window", "no".into()),
        ("audio-display", "no".into()),
        ("gapless-audio", "weak".into()),
        ("prefetch-playlist", "yes".into()),
        ("cache", "yes".into()),
        ("user-agent", "Scrappy/mpv".into()),
        ("input-default-bindings", "no".into()),
        ("volume-max", "100".into()),
    ];
    static NEXT_ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let app2 = app.clone();
    let last_emit = Mutex::new(std::time::Instant::now());
    let player = mpv::Player::create(&state.mpv_dirs, &opts, OBSERVED, move |ev| on_event(&app2, id, &last_emit, ev))?;
    *state.music.lock().unwrap() = Some((id, player.clone()));
    Ok(player)
}

fn stream_url(state: &AppState, id: &str) -> String {
    let cfg = state.cfg();
    servers::nd_url(&cfg, "stream", &format!("id={}", servers::enc(id)))
}

/// Start playing `ids` from the first one. Replaces whatever was playing.
#[tauri::command]
pub fn music_play(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>, volume: Option<f64>) -> Result<(), String> {
    if ids.is_empty() {
        return Err("Nothing to play.".into());
    }
    if !state.cfg().nd_logged_in() {
        return Err("ND_SESSION_EXPIRED".into());
    }
    let p = ensure(&app)?;
    if let Some(v) = volume {
        let _ = p.set_property("volume", &format!("{v:.0}"));
    }
    p.command(&["stop"])?;
    for id in &ids {
        p.command(&["loadfile", &stream_url(&state, id), "append"])?;
    }
    p.set_property("pause", "no")?;
    p.set_property("playlist-pos", "0")
}

/// Keep the current song playing and replace what comes after it.
#[tauri::command]
pub fn music_upnext(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>) -> Result<(), String> {
    let p = ensure(&app)?;
    p.command(&["playlist-clear"])?;
    for id in &ids {
        p.command(&["loadfile", &stream_url(&state, id), "append"])?;
    }
    Ok(())
}

#[tauri::command]
pub fn music_command(state: State<'_, AppState>, args: Vec<String>) -> Result<(), String> {
    let p = state.music.lock().unwrap().as_ref().map(|(_, p)| p.clone()).ok_or("Nothing is playing.")?;
    let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    p.command(&a)
}

#[tauri::command]
pub fn music_set(state: State<'_, AppState>, name: String, value: String) -> Result<(), String> {
    match state.music.lock().unwrap().as_ref() {
        Some((_, p)) => p.set_property(&name, &value),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn music_get(state: State<'_, AppState>, name: String) -> Value {
    state.music.lock().unwrap().as_ref().map(|(_, p)| p.get_property(&name)).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn music_stop(state: State<'_, AppState>) {
    if let Some((_, p)) = state.music.lock().unwrap().as_ref() {
        let _ = p.command(&["stop"]);
    }
}

pub fn quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let m = state.music.lock().unwrap().take();
    if let Some((_, p)) = m {
        p.quit();
    }
}
