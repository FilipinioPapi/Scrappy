mod emby;
mod mpv;

use emby::Config;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    cfg: Mutex<Config>,
    cfg_path: PathBuf,
    cache_dir: PathBuf,
    mpv_dirs: Vec<PathBuf>,
    http: reqwest::Client,
    player: Mutex<Option<(usize, bool, mpv::Player)>>,
    now: Mutex<Option<NowPlaying>>,
}

impl AppState {
    fn cfg(&self) -> Config {
        self.cfg.lock().unwrap().clone()
    }
}

// ---------- Login ----------

#[tauri::command]
fn get_session(state: State<'_, AppState>) -> Value {
    let c = state.cfg();
    json!({
        "loggedIn": c.logged_in(),
        "server": c.server,
        "serverName": c.server_name,
        "userName": c.user_name,
        "userId": c.user_id,
    })
}

#[tauri::command]
async fn login(
    state: State<'_, AppState>,
    server: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    if server.trim().is_empty() {
        return Err("Enter your server address.".into());
    }
    if username.trim().is_empty() {
        return Err("Enter your username.".into());
    }
    let (base, server_name) = emby::find_server(&state.http, &server).await?;
    let mut cfg = state.cfg();
    cfg.token.clear();
    cfg.user_id.clear();
    let (token, user_id) =
        emby::authenticate(&state.http, &cfg, &base, username.trim(), &password).await?;
    cfg.server = base;
    cfg.server_name = server_name;
    cfg.user_name = username.trim().to_string();
    cfg.token = token;
    cfg.user_id = user_id;
    cfg.save(&state.cfg_path)?;
    *state.cfg.lock().unwrap() = cfg;
    Ok(get_session(state))
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    let cfg = state.cfg();
    if cfg.logged_in() {
        // Tell Emby to forget this token; ignore failures (server may be offline).
        let _ = emby::send(&state.http, &cfg, reqwest::Method::POST, "/Sessions/Logout", None).await;
    }
    let mut c = state.cfg.lock().unwrap();
    c.token.clear();
    c.user_id.clear();
    c.save(&state.cfg_path)?;
    Ok(())
}

// ---------- Library data, with an on-disk cache ----------

fn meta_cache_file(state: &AppState, cfg: &Config, path: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    (&cfg.server, &cfg.user_id, path).hash(&mut h);
    state.cache_dir.join("meta").join(format!("{:016x}.json", h.finish()))
}

/// Fetch fresh data from Emby and save a copy for instant loading next time.
#[tauri::command]
async fn api_get(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    let cfg = state.cfg();
    let v = emby::get(&state.http, &cfg, &path).await?;
    let file = meta_cache_file(&state, &cfg, &path);
    if let Some(d) = file.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(&file, serde_json::to_vec(&v).unwrap_or_default());
    Ok(v)
}

/// Return the last saved copy of a request, or null.
#[tauri::command]
fn api_cached(state: State<'_, AppState>, path: String) -> Value {
    let cfg = state.cfg();
    let file = meta_cache_file(&state, &cfg, &path);
    std::fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

// ---------- Playback ----------
//
// One mpv instance lives while the player is open. In "embedded" mode it draws
// into Scrappy's own window behind the (transparent) web page, and the page
// draws our controls on top. In "window" mode mpv opens its own window.

#[derive(Clone)]
struct NowPlaying {
    item_id: String,
    media_source_id: String,
    play_session_id: String,
    play_method: String,
    pos_ticks: i64,
    paused: bool,
    started: bool,
}

fn report_body(np: &NowPlaying, event: Option<&str>) -> Value {
    let mut v = json!({
        "ItemId": np.item_id,
        "MediaSourceId": np.media_source_id,
        "PlaySessionId": np.play_session_id,
        "PlayMethod": np.play_method,
        "PositionTicks": np.pos_ticks,
        "IsPaused": np.paused,
        "CanSeek": true,
        "QueueableMediaTypes": ["Video"],
    });
    if let Some(e) = event {
        v["EventName"] = json!(e);
    }
    v
}

/// Send a playback report to Emby in the background.
fn report(app: &AppHandle, path: &'static str, body: Value) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let cfg = state.cfg();
        let _ = emby::send(&state.http, &cfg, reqwest::Method::POST, path, Some(body)).await;
    });
}

/// Tell Emby the current item stopped (saves the resume point) and forget it.
fn finish_current(app: &AppHandle) -> Option<NowPlaying> {
    let state = app.state::<AppState>();
    let np = state.now.lock().unwrap().take()?;
    if np.started {
        report(app, "/Sessions/Playing/Stopped", report_body(&np, None));
    }
    Some(np)
}

fn on_mpv_event(app: &AppHandle, player_id: usize, last_emit: &Mutex<std::time::Instant>, ev: mpv::Event) {
    let state = app.state::<AppState>();
    match ev {
        mpv::Event::Property(name, value) => {
            if name == "time-pos" {
                if let Some(secs) = value.as_f64() {
                    if let Some(np) = state.now.lock().unwrap().as_mut() {
                        np.pos_ticks = (secs * 10_000_000.0) as i64;
                    }
                }
                // Only update the UI about 4 times a second.
                let mut last = last_emit.lock().unwrap();
                if last.elapsed().as_millis() < 250 {
                    return;
                }
                *last = std::time::Instant::now();
            }
            if name == "pause" {
                let paused = value.as_bool().unwrap_or(false);
                let snapshot = {
                    let mut now = state.now.lock().unwrap();
                    now.as_mut().map(|np| {
                        np.paused = paused;
                        np.clone()
                    })
                };
                if let Some(np) = snapshot.filter(|n| n.started) {
                    let ev = if paused { "Pause" } else { "Unpause" };
                    report(app, "/Sessions/Playing/Progress", report_body(&np, Some(ev)));
                }
            }
            let _ = app.emit("mpv-prop", json!({ "name": name, "value": value }));
        }
        mpv::Event::FileLoaded => {
            let snapshot = {
                let mut now = state.now.lock().unwrap();
                now.as_mut().map(|np| {
                    np.started = true;
                    np.clone()
                })
            };
            if let Some(np) = snapshot {
                report(app, "/Sessions/Playing", report_body(&np, None));
                let _ = app.emit("player-loaded", json!({ "itemId": np.item_id }));
            }
        }
        mpv::Event::EndFile { eof, error } => {
            if let Some(err) = error {
                let np = state.now.lock().unwrap().take();
                let _ = app.emit(
                    "player-ended",
                    json!({ "itemId": np.map(|n| n.item_id), "eof": false, "error": err }),
                );
                return;
            }
            // An end event for a file we already replaced: ignore it.
            let started = state.now.lock().unwrap().as_ref().map(|n| n.started).unwrap_or(false);
            if !started {
                return;
            }
            if let Some(np) = finish_current(app) {
                let _ = app.emit("player-ended", json!({ "itemId": np.item_id, "eof": eof, "error": null }));
            }
        }
        mpv::Event::Shutdown => {
            finish_current(app);
            let mut p = state.player.lock().unwrap();
            if p.as_ref().map(|(id, _, _)| *id == player_id).unwrap_or(false) {
                *p = None;
            }
            drop(p);
            let _ = app.emit("player-closed", json!({}));
        }
    }
}

fn main_hwnd(app: &AppHandle) -> Option<i64> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let w = app.get_webview_window("main")?;
    let h = w.window_handle().ok()?;
    match h.as_raw() {
        RawWindowHandle::Win32(h) => Some(h.hwnd.get() as i64),
        RawWindowHandle::Xlib(h) => Some(h.window as i64),
        _ => None,
    }
}

const OBSERVED: &[&str] = &[
    "time-pos", "duration", "pause", "paused-for-cache", "seeking", "volume", "mute",
    "eof-reached", "demuxer-cache-time", "track-list", "speed",
];

fn ensure_player(app: &AppHandle, embedded: bool) -> Result<mpv::Player, String> {
    let state = app.state::<AppState>();
    {
        let p = state.player.lock().unwrap();
        if let Some((_, mode, player)) = p.as_ref() {
            if *mode == embedded && player.alive() {
                return Ok(player.clone());
            }
            player.quit();
        }
    }
    let mut opts: Vec<(&str, String)> = vec![
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("idle", "yes".into()),
        ("keep-open", "no".into()),
        ("force-window", "yes".into()),
        ("hwdec", "auto-safe".into()),
        ("vo", "gpu".into()),
        ("sub-auto", "fuzzy".into()),
        ("cache", "yes".into()),
        ("demuxer-max-bytes", "150MiB".into()),
        ("user-agent", "Scrappy/mpv".into()),
        ("input-default-bindings", "yes".into()),
    ];
    if embedded {
        let wid = main_hwnd(app).ok_or("Couldn't find the Scrappy window to play in.")?;
        opts.push(("wid", wid.to_string()));
        opts.push(("osc", "no".into()));
        opts.push(("osd-level", "0".into()));
        opts.push(("input-vo-keyboard", "no".into()));
        opts.push(("input-cursor", "no".into()));
        opts.push(("cursor-autohide", "no".into()));
    } else {
        opts.push(("osc", "yes".into()));
        opts.push(("input-vo-keyboard", "yes".into()));
        opts.push(("input-media-keys", "yes".into()));
        opts.push(("autofit", "85%x85%".into()));
    }

    static NEXT_ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let app2 = app.clone();
    let last_emit = Mutex::new(std::time::Instant::now());
    let player = mpv::Player::create(&state.mpv_dirs, &opts, OBSERVED, move |ev| {
        on_mpv_event(&app2, id, &last_emit, ev)
    })?;
    *state.player.lock().unwrap() = Some((id, embedded, player.clone()));
    Ok(player)
}

fn display_title(item: &Value) -> String {
    match item["Type"].as_str() {
        Some("Episode") => format!(
            "{} - S{:02}E{:02} - {}",
            item["SeriesName"].as_str().unwrap_or(""),
            item["ParentIndexNumber"].as_i64().unwrap_or(0),
            item["IndexNumber"].as_i64().unwrap_or(0),
            item["Name"].as_str().unwrap_or("")
        ),
        _ => item["Name"].as_str().unwrap_or("Scrappy").to_string(),
    }
}

/// Start playing an item. Returns the item's details for the player screen.
#[tauri::command]
async fn play(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    from_start: Option<bool>,
    embedded: Option<bool>,
) -> Result<Value, String> {
    let embedded = embedded.unwrap_or(true);
    let cfg = state.cfg();
    let item = emby::get(&state.http, &cfg, &format!("/Users/{{userId}}/Items/{item_id}")).await?;
    let start_ticks = if from_start.unwrap_or(false) {
        0
    } else {
        item["UserData"]["PlaybackPositionTicks"].as_i64().unwrap_or(0)
    };
    let target = emby::playback_target(&state.http, &cfg, &item_id, start_ticks).await?;

    // Save the resume point of whatever was playing before.
    finish_current(&app);

    let player = ensure_player(&app, embedded)?;
    *state.now.lock().unwrap() = Some(NowPlaying {
        item_id: item_id.clone(),
        media_source_id: target.media_source_id.clone(),
        play_session_id: target.play_session_id.clone(),
        play_method: target.play_method.clone(),
        pos_ticks: start_ticks,
        paused: false,
        started: false,
    });
    let title = display_title(&item);
    let start = if start_ticks > 10_000_000 {
        format!("{:.3}", start_ticks as f64 / 10_000_000.0)
    } else {
        "none".to_string()
    };
    let _ = player.set_property("start", &start);
    let _ = player.set_property("force-media-title", &title);
    let _ = player.set_property("title", &format!("{title} - Scrappy Media Center"));
    let _ = player.set_property("pause", "no");
    player.command(&["loadfile", &target.url, "replace"])?;

    Ok(json!({
        "item": item,
        "title": title,
        "playMethod": target.play_method,
        "embedded": embedded,
    }))
}

/// Run an mpv command, e.g. ["seek", "10"] or ["cycle", "pause"].
#[tauri::command]
fn player_command(state: State<'_, AppState>, args: Vec<String>) -> Result<(), String> {
    let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
    let p = p.ok_or("Nothing is playing.")?;
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    p.command(&refs)
}

#[tauri::command]
fn player_set(state: State<'_, AppState>, name: String, value: String) -> Result<(), String> {
    let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
    p.ok_or("Nothing is playing.")?.set_property(&name, &value)
}

#[tauri::command]
fn player_get(state: State<'_, AppState>, name: String) -> Value {
    let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
    p.map(|p| p.get_property(&name)).unwrap_or(Value::Null)
}

#[tauri::command]
fn stop_playback(app: AppHandle, state: State<'_, AppState>) {
    finish_current(&app);
    if let Some((_, _, p)) = state.player.lock().unwrap().take() {
        p.quit();
    }
}

#[tauri::command]
fn set_fullscreen(app: AppHandle, on: bool) -> Result<bool, String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(on)
}

#[tauri::command]
fn is_fullscreen(app: AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_fullscreen().ok()).unwrap_or(false)
}

// ---------- Poster/backdrop images, cached on disk ----------
//
// The UI asks for img://localhost/<itemId>/<ImageType>?tag=..&w=..
// We serve from disk if we have it, otherwise download once from Emby.

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect()
}

fn sniff_mime(b: &[u8]) -> &'static str {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        "image/webp"
    } else if b.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "image/jpeg"
    }
}

fn img_response(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

async fn serve_image(app: AppHandle, uri: String) -> Response<Vec<u8>> {
    let state = app.state::<AppState>();
    let not_found = || img_response(StatusCode::NOT_FOUND, "text/plain", Vec::new());

    let parsed = match reqwest::Url::parse(&uri) {
        Ok(u) => u,
        Err(_) => return not_found(),
    };
    let parts: Vec<&str> = parsed.path().trim_matches('/').split('/').collect();
    if parts.len() < 2 {
        return not_found();
    }
    let (item_id, img_type) = (parts[0], parts[1]);
    let index = parts.get(2).copied().unwrap_or("");
    let mut tag = String::new();
    let mut width = String::from("400");
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "tag" => tag = v.to_string(),
            "w" => width = v.to_string(),
            _ => {}
        }
    }

    let cfg = state.cfg();
    let file = state.cache_dir.join("img").join(format!(
        "{}_{}_{}_{}_{}",
        sanitize(item_id),
        sanitize(img_type),
        sanitize(index),
        sanitize(&tag),
        sanitize(&width)
    ));
    if let Ok(bytes) = std::fs::read(&file) {
        return img_response(StatusCode::OK, sniff_mime(&bytes), bytes);
    }
    if !cfg.logged_in() {
        return not_found();
    }
    let idx = if index.is_empty() { String::new() } else { format!("/{index}") };
    let url = format!(
        "{}/Items/{}/Images/{}{}?maxWidth={}&quality=90{}",
        cfg.server,
        item_id,
        img_type,
        idx,
        width,
        if tag.is_empty() { String::new() } else { format!("&tag={tag}") }
    );
    match state.http.get(url).header("X-Emby-Token", &cfg.token).send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => {
                let b = b.to_vec();
                if let Some(d) = file.parent() {
                    let _ = std::fs::create_dir_all(d);
                }
                let _ = std::fs::write(&file, &b);
                img_response(StatusCode::OK, sniff_mime(&b), b)
            }
            Err(_) => not_found(),
        },
        _ => not_found(),
    }
}

#[tauri::command]
fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(state.cache_dir.join("img"));
    let _ = std::fs::remove_dir_all(state.cache_dir.join("meta"));
    Ok(())
}

async fn tokio_sleep(secs: u64) {
    tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
}

pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("img", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                responder.respond(serve_image(app, uri).await);
            });
        })
        .setup(|app| {
            let cfg_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let cfg_path = cfg_dir.join("config.json");
            let cfg = Config::load(&cfg_path);

            let mut mpv_dirs = Vec::new();
            if let Ok(r) = app.path().resource_dir() {
                mpv_dirs.push(r);
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(d) = exe.parent() {
                    mpv_dirs.push(d.to_path_buf());
                }
            }

            app.manage(AppState {
                cfg: Mutex::new(cfg),
                cfg_path,
                cache_dir,
                mpv_dirs,
                http: emby::http_client(),
                player: Mutex::new(None),
                now: Mutex::new(None),
            });

            // Every 10 seconds, tell Emby where we are (so resume works elsewhere).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio_sleep(10).await;
                    let state = handle.state::<AppState>();
                    let np = state.now.lock().unwrap().clone();
                    if let Some(np) = np.filter(|n| n.started && !n.paused) {
                        report(&handle, "/Sessions/Playing/Progress", report_body(&np, Some("TimeUpdate")));
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the app mid-video: save the resume point first.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                let state = app.state::<AppState>();
                let np = state.now.lock().unwrap().take();
                if let Some(np) = np.filter(|n| n.started) {
                    let cfg = state.cfg();
                    let http = state.http.clone();
                    let body = report_body(&np, None);
                    let _ = tauri::async_runtime::block_on(async move {
                        tokio::time::timeout(
                            std::time::Duration::from_secs(3),
                            emby::send(&http, &cfg, reqwest::Method::POST, "/Sessions/Playing/Stopped", Some(body)),
                        )
                        .await
                    });
                }
                let player = state.player.lock().unwrap().take();
                if let Some((_, _, p)) = player {
                    p.quit();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_session,
            login,
            logout,
            api_get,
            api_cached,
            play,
            player_command,
            player_set,
            player_get,
            stop_playback,
            set_fullscreen,
            is_fullscreen,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scrappy");
}
