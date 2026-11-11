mod emby;
mod follow;
mod mpv;
mod music;
mod requests;
mod servers;
mod updates;
mod appset;

use emby::Config;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
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
    /// The audio-only player for music: (instance id, player).
    music: Mutex<Option<(usize, mpv::Player)>>,
    now: Mutex<Option<NowPlaying>>,
    /// Seek-bar preview pictures for the current video: (item id, frames).
    bif: Mutex<Option<(String, Vec<Vec<u8>>)>>,
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
        "loggedIn": c.logged_in() || c.nd_logged_in() || c.abs_logged_in(),
        "server": c.server,
        "serverName": c.server_name,
        "userName": c.user_name,
        "userId": c.user_id,
        "servers": {
            "emby": { "signedIn": c.logged_in(), "address": c.server, "name": c.server_name, "user": c.user_name },
            "navidrome": { "signedIn": c.nd_logged_in(), "address": c.nd_server, "name": c.nd_name, "user": c.nd_user },
            "audiobookshelf": { "signedIn": c.abs_logged_in(), "address": c.abs_server, "name": c.abs_name, "user": c.abs_user },
        },
    })
}

/// Step 1 of signing in: is there really an Emby / Navidrome / Audiobookshelf there?
#[tauri::command]
async fn server_check(state: State<'_, AppState>, kind: String, address: String) -> Result<Value, String> {
    if address.trim().is_empty() {
        return Err("Enter your server address.".into());
    }
    let (base, name) = match kind.as_str() {
        "emby" => emby::find_server(&state.http, &address).await?,
        "navidrome" => servers::nd_find(&state.http, &address).await?,
        "audiobookshelf" => servers::abs_find(&state.http, &address).await?,
        _ => return Err("Unknown server type.".into()),
    };
    Ok(json!({ "address": base, "name": name }))
}

/// Step 2: sign in with the address found in step 1.
#[tauri::command]
async fn server_login(
    state: State<'_, AppState>,
    kind: String,
    address: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    if username.trim().is_empty() {
        return Err("Enter your username.".into());
    }
    let user = username.trim();
    match kind.as_str() {
        "emby" => {
            login(state.clone(), address, username, password).await?;
        }
        "navidrome" => {
            let (base, name) = servers::nd_find(&state.http, &address).await?;
            let (u, salt, token, jwt) = servers::nd_login(&state.http, &base, user, &password).await?;
            let mut c = state.cfg.lock().unwrap();
            c.nd_jwt = jwt;
            c.nd_server = base;
            c.nd_name = name;
            c.nd_user = u;
            c.nd_salt = salt;
            c.nd_token = token;
            c.save(&state.cfg_path)?;
        }
        "audiobookshelf" => {
            let (base, name) = servers::abs_find(&state.http, &address).await?;
            let (u, token) = servers::abs_login(&state.http, &base, user, &password).await?;
            let mut c = state.cfg.lock().unwrap();
            c.abs_server = base;
            c.abs_name = name;
            c.abs_user = u;
            c.abs_token = token;
            c.save(&state.cfg_path)?;
        }
        _ => return Err("Unknown server type.".into()),
    }
    Ok(get_session(state))
}

/// Sign out of one server. The address and username stay filled in for next time.
#[tauri::command]
async fn server_logout(state: State<'_, AppState>, kind: String) -> Result<Value, String> {
    match kind.as_str() {
        "emby" => logout_emby(&state).await?,
        "navidrome" => {
            let mut c = state.cfg.lock().unwrap();
            c.nd_token.clear();
            c.nd_salt.clear();
            c.nd_jwt.clear();
            c.save(&state.cfg_path)?;
        }
        "audiobookshelf" => {
            let cfg = state.cfg();
            if cfg.abs_logged_in() {
                let _ = state.http.post(format!("{}/logout", cfg.abs_server)).bearer_auth(&cfg.abs_token).send().await;
            }
            let mut c = state.cfg.lock().unwrap();
            c.abs_token.clear();
            c.save(&state.cfg_path)?;
        }
        _ => return Err("Unknown server type.".into()),
    }
    Ok(get_session(state))
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

async fn logout_emby(state: &AppState) -> Result<(), String> {
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

/// "Sign out" in the account menu: every server at once.
#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    logout_emby(&state).await?;
    let mut c = state.cfg.lock().unwrap();
    c.nd_token.clear();
    c.nd_salt.clear();
    c.abs_token.clear();
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

/// Change something on the server: POST / DELETE with an optional JSON body.
#[tauri::command]
async fn api_send(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let cfg = state.cfg();
    let m = match method.to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "DELETE" => reqwest::Method::DELETE,
        "PUT" => reqwest::Method::PUT,
        _ => return Err("Unsupported request.".into()),
    };
    emby::send(&state.http, &cfg, m, &path, body).await
}

/// Upload a picture (base64) for an item, e.g. a new poster.
#[tauri::command]
async fn api_upload_image(state: State<'_, AppState>, path: String, base64: String, content_type: String) -> Result<Value, String> {
    let cfg = state.cfg();
    emby::send_raw(&state.http, &cfg, reqwest::Method::POST, &path, base64, &content_type).await
}

/// Follow along in its own window: open it (or bring it to the front if it's already open).
/// The main window keeps playing the book and sends the pop-out its position.
#[tauri::command]
async fn fa_popout(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("follow") {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    #[cfg(desktop)]
    let made = tauri::WebviewWindowBuilder::new(&app, "follow", tauri::WebviewUrl::App("follow.html".into()))
        .title("Scrappy \u{b7} Follow along")
        .inner_size(1100.0, 760.0)
        .min_inner_size(560.0, 420.0)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string());
    #[cfg(not(desktop))]
    let made: Result<(), String> = Err("Pop-out windows are only on the PC app.".into());
    made
}

/// Send the text back into the main window: close the pop-out (the main window hears "fa-popin").
#[tauri::command]
fn fa_popin(app: AppHandle) {
    if let Some(w) = app.get_webview_window("follow") {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

/// Save a picture (PNG bytes) in Pictures\Scrappy, e.g. a Year in Review card,
/// then show it in the file manager. Returns where it went.
#[tauri::command]
fn save_png(app: AppHandle, name: String, data: Vec<u8>) -> Result<String, String> {
    if !data.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("Not a picture".into());
    }
    let base = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("Scrappy");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' })
        .collect();
    let stem = stem.trim().to_string();
    let mut path = dir.join(format!("{stem}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).png"));
        n += 1;
    }
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    Ok(path.display().to_string())
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

fn cache_file(state: &AppState, key: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    state.cache_dir.join("meta").join(format!("{:016x}.json", h.finish()))
}

fn save_cache(file: &PathBuf, v: &Value) {
    if let Some(d) = file.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(file, serde_json::to_vec(v).unwrap_or_default());
}

fn read_cache(file: &PathBuf) -> Value {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

fn nd_key(cfg: &Config, endpoint: &str, query: &str) -> String {
    format!("nd|{}|{}|{}?{}", cfg.nd_server, cfg.nd_user, endpoint, query)
}

/// Navidrome (Subsonic API) call, e.g. nd_get("getAlbumList2", "type=newest&size=30").
#[tauri::command]
async fn nd_get(state: State<'_, AppState>, endpoint: String, query: String) -> Result<Value, String> {
    let cfg = state.cfg();
    let v = servers::nd_get(&state.http, &cfg, &endpoint, &query).await?;
    save_cache(&cache_file(&state, &nd_key(&cfg, &endpoint, &query)), &v);
    Ok(v)
}

#[tauri::command]
fn nd_cached(state: State<'_, AppState>, endpoint: String, query: String) -> Value {
    let cfg = state.cfg();
    read_cache(&cache_file(&state, &nd_key(&cfg, &endpoint, &query)))
}

#[tauri::command]
async fn abs_get(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    let cfg = state.cfg();
    let v = servers::abs_get(&state.http, &cfg, &path).await?;
    save_cache(&cache_file(&state, &format!("abs|{}|{}|{}", cfg.abs_server, cfg.abs_user, path)), &v);
    Ok(v)
}

#[tauri::command]
async fn req_call(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let cfg = state.cfg();
    requests::call(&state.http, &cfg, &method, &path, body).await
}

/// Where the request service is: (address in use, whether it was set by hand).
#[tauri::command]
fn req_address(state: State<'_, AppState>) -> Value {
    let c = state.cfg();
    json!({ "address": requests::base(&c), "custom": !c.requests_url.trim().is_empty() })
}

/// Set the request service address by hand (empty = back to the Emby address + /requests).
#[tauri::command]
fn req_set_address(state: State<'_, AppState>, address: String) -> Result<(), String> {
    let mut c = state.cfg.lock().unwrap();
    c.requests_url = address.trim().trim_end_matches('/').to_string();
    c.save(&state.cfg_path)
}

#[tauri::command]
async fn abs_send(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let cfg = state.cfg();
    servers::abs_send(&state.http, &cfg, &method, &path, body).await
}

/// Change (bytes + file name) or remove (no bytes) a playlist's cover.
#[tauri::command]
async fn nd_playlist_image(state: State<'_, AppState>, id: String, bytes: Option<Vec<u8>>, name: Option<String>) -> Result<(), String> {
    let cfg = state.cfg();
    let img = bytes.map(|b| (b, name.unwrap_or_else(|| "cover.jpg".into())));
    if let Some(fresh) = servers::nd_playlist_image(&state.http, &cfg, &id, img).await? {
        let mut c = state.cfg.lock().unwrap();
        c.nd_jwt = fresh;
        c.save(&state.cfg_path)?;
    }
    Ok(())
}

/// Read from Navidrome's own API; keeps its session fresh.
#[tauri::command]
async fn nd_native_get(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    let cfg = state.cfg();
    let (body, total, fresh) = servers::nd_native_get(&state.http, &cfg, &path).await?;
    if let Some(f) = fresh {
        if !f.is_empty() && f != cfg.nd_jwt {
            let mut c = state.cfg.lock().unwrap();
            c.nd_jwt = f;
            let _ = c.save(&state.cfg_path);
        }
    }
    Ok(serde_json::json!({ "data": body, "total": total }))
}

/// Confirm the Navidrome password again (only needed when its web session ran out).
#[tauri::command]
async fn nd_reauth(state: State<'_, AppState>, password: String) -> Result<(), String> {
    let cfg = state.cfg();
    let (_, salt, token, jwt) = servers::nd_login(&state.http, &cfg.nd_server, &cfg.nd_user, &password).await?;
    let mut c = state.cfg.lock().unwrap();
    c.nd_salt = salt;
    c.nd_token = token;
    c.nd_jwt = jwt;
    c.save(&state.cfg_path)
}

#[tauri::command]
async fn lyrics_find(state: State<'_, AppState>, artist: String, title: String, album: String, duration: u64) -> Result<Value, String> {
    servers::lyrics_find(&state.http, &artist, &title, &album, duration).await
}

#[tauri::command]
fn abs_cached(state: State<'_, AppState>, path: String) -> Value {
    let cfg = state.cfg();
    read_cache(&cache_file(&state, &format!("abs|{}|{}|{}", cfg.abs_server, cfg.abs_user, path)))
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
    external_subs: Vec<(String, String, String)>,
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

fn on_mpv_event(
    app: &AppHandle,
    player_id: usize,
    last_emit: &Mutex<std::time::Instant>,
    last_cache: &Mutex<std::time::Instant>,
    ev: mpv::Event,
) {
    let state = app.state::<AppState>();
    match ev {
        mpv::Event::Property(name, value) => {
            if name == "time-pos" {
                if let Some(secs) = value.as_f64() {
                    if let Some(np) = state.now.lock().unwrap().as_mut() {
                        np.pos_ticks = (secs * 10_000_000.0) as i64;
                    }
                }
                // Only update the UI about 4 times a second (the page glides the bar in between).
                let mut last = last_emit.lock().unwrap();
                if last.elapsed().as_millis() < 250 {
                    return;
                }
                *last = std::time::Instant::now();
            }
            if name == "demuxer-cache-time" {
                // The buffered bar doesn't need more than one update a second.
                let mut last = last_cache.lock().unwrap();
                if last.elapsed().as_millis() < 1000 {
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
            // Add the server's external subtitle files (without switching to them).
            let subs = state.now.lock().unwrap().as_ref().map(|n| n.external_subs.clone()).unwrap_or_default();
            if !subs.is_empty() {
                let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
                if let Some(p) = p {
                    for (url, title, lang) in subs {
                        let _ = p.command(&["sub-add", &url, "auto", &title, &lang]);
                    }
                }
            }
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
    "eof-reached", "demuxer-cache-time", "track-list", "speed", "vo-configured",
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
        // Smooth motion: match the video to the screen's refresh rate and blend
        // frames, so 24fps films don't judder on 60/120/144Hz screens.
        ("video-sync", "display-resample".into()),
        ("interpolation", "yes".into()),
        ("tscale", "oversample".into()),
        // Arrow-key skips land exactly where you asked, not on the nearest keyframe.
        ("hr-seek", "yes".into()),
        ("sub-auto", "fuzzy".into()),
        // Don't let mpv jump to forced subtitles just because they match the audio
        // language (it picked Dark's German forced ones over its English default).
        ("subs-fallback-forced", "no".into()),
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
    let last_cache = Mutex::new(std::time::Instant::now());
    let player = mpv::Player::create(&state.mpv_dirs, &opts, OBSERVED, move |ev| {
        on_mpv_event(&app2, id, &last_emit, &last_cache, ev)
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

/// Ctrl + / Ctrl - : scale the whole app (the page asks for a clamped level).
#[tauri::command]
fn set_zoom(window: tauri::WebviewWindow, level: f64) -> Result<(), String> {
    window.set_zoom(level.clamp(0.5, 2.0)).map_err(|e| e.to_string())
}

/// Start playing an item. Returns the item's details for the player screen.
#[tauri::command]
async fn play(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    from_start: Option<bool>,
    embedded: Option<bool>,
    start_secs: Option<f64>,
    max_bitrate: Option<u64>,
) -> Result<Value, String> {
    let embedded = embedded.unwrap_or(true);
    let cfg = state.cfg();
    // Fetch the item and the stream details at the same time.
    let item_path = format!("/Users/{{userId}}/Items/{item_id}?Fields=Chapters");
    let (item, target) = tokio::join!(
        emby::get(&state.http, &cfg, &item_path),
        // mpv seeks to the start point itself, so the stream always starts at 0 and
        // positions stay true to the file even when Emby transcodes.
        emby::playback_target(&state.http, &cfg, &item_id, 0, max_bitrate),
    );
    let (item, target) = (item?, target?);
    let start_ticks = if let Some(s) = start_secs {
        (s * 10_000_000.0) as i64
    } else if from_start.unwrap_or(false) {
        0
    } else {
        item["UserData"]["PlaybackPositionTicks"].as_i64().unwrap_or(0)
    };

    // Save the resume point of whatever was playing before.
    finish_current(&app);
    // A video starting pauses the music.
    if let Some((_, m)) = state.music.lock().unwrap().as_ref() {
        let _ = m.set_property("pause", "yes");
    }

    let player = ensure_player(&app, embedded)?;
    *state.now.lock().unwrap() = Some(NowPlaying {
        item_id: item_id.clone(),
        media_source_id: target.media_source_id.clone(),
        play_session_id: target.play_session_id.clone(),
        play_method: target.play_method.clone(),
        pos_ticks: start_ticks,
        paused: false,
        started: false,
        external_subs: target
            .external_subs
            .iter()
            .map(|s| (s.url.clone(), s.title.clone(), s.lang.clone()))
            .collect(),
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
    // Track picks from the last video must not carry over to this one (a subtitle
    // number that was English there can be German here). The page picks again.
    let _ = player.set_property("sid", "auto");
    let _ = player.set_property("aid", "auto");
    player.command(&["loadfile", &target.url, "replace"])?;

    Ok(json!({
        "item": item,
        "title": title,
        "playMethod": target.play_method,
        "embedded": embedded,
        "defaults": target.defaults,
    }))
}

// ---------- Seek-bar previews ----------
//
// Emby's "thumbnail image extraction" makes a BIF file per video: a list of
// small JPEG frames taken every few seconds. We load it once per video and
// serve single frames to the page through the img protocol.

fn parse_bif(b: &[u8]) -> Option<(Vec<Vec<u8>>, u32)> {
    if b.len() < 64 || &b[0..8] != b"\x89BIF\r\n\x1a\n" {
        return None;
    }
    let u32_at = |i: usize| -> Option<u32> { b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])) };
    let count = u32_at(12)? as usize;
    let mut interval = u32_at(16)?;
    if interval == 0 {
        interval = 1000;
    }
    let mut entries = Vec::with_capacity(count + 1);
    for n in 0..=count {
        let at = 64 + n * 8;
        let (ts, off) = (u32_at(at)?, u32_at(at + 4)? as usize);
        entries.push((ts, off));
        if ts == 0xffff_ffff {
            break;
        }
    }
    let mut frames = Vec::new();
    for w in entries.windows(2) {
        let (start, end) = (w[0].1, w[1].1);
        if end <= start || end > b.len() {
            break;
        }
        frames.push(b[start..end].to_vec());
    }
    if frames.is_empty() {
        return None;
    }
    Some((frames, interval))
}

/// Load seek previews for what's playing. Returns {count, intervalMs} or count 0.
#[tauri::command]
async fn load_previews(state: State<'_, AppState>, item_id: String) -> Result<Value, String> {
    let ms = state
        .now
        .lock()
        .unwrap()
        .as_ref()
        .filter(|n| n.item_id == item_id)
        .map(|n| n.media_source_id.clone())
        .unwrap_or_default();
    let cfg = state.cfg();
    let tries = [
        format!("/Videos/{item_id}/index.bif?width=320&MediaSourceId={ms}"),
        format!("/Videos/{item_id}/index.bif?width=320"),
        format!("/Videos/{item_id}/{ms}/index.bif?width=320"),
    ];
    for path in tries.iter() {
        if let Ok(Some(bytes)) = emby::get_bytes(&state.http, &cfg, path).await {
            if let Some((frames, interval)) = parse_bif(&bytes) {
                let count = frames.len();
                *state.bif.lock().unwrap() = Some((item_id.clone(), frames));
                return Ok(json!({ "count": count, "intervalMs": interval }));
            }
        }
    }
    *state.bif.lock().unwrap() = None;
    Ok(json!({ "count": 0, "intervalMs": 0 }))
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

/// Add a subtitle file that was just downloaded to the server to the video that's
/// playing, and turn it on. `index` is Emby's stream number for the new subtitles.
#[tauri::command]
fn player_add_sub(state: State<'_, AppState>, index: i64, codec: String, title: String, lang: String) -> Result<(), String> {
    let c = state.cfg();
    let url = {
        let mut now = state.now.lock().unwrap();
        let np = now.as_mut().ok_or("Nothing is playing.")?;
        let fmt = match codec.to_lowercase().as_str() {
            "ass" | "ssa" => codec.to_lowercase(),
            "vtt" | "webvtt" => "vtt".to_string(),
            _ => "srt".to_string(),
        };
        let url = format!(
            "{}/Videos/{}/{}/Subtitles/{}/Stream.{}?api_key={}",
            c.server.trim_end_matches('/'), np.item_id, np.media_source_id, index, fmt, c.token
        );
        // Also add it again if the same video gets reloaded.
        np.external_subs.push((url.clone(), title.clone(), lang.clone()));
        url
    };
    let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
    p.ok_or("Nothing is playing.")?.command(&["sub-add", &url, "select", &title, &lang])
}

#[tauri::command]
fn player_get(state: State<'_, AppState>, name: String) -> Value {
    let p = state.player.lock().unwrap().as_ref().map(|(_, _, p)| p.clone());
    p.map(|p| p.get_property(&name)).unwrap_or(Value::Null)
}

#[tauri::command]
fn stop_playback(app: AppHandle, state: State<'_, AppState>) {
    finish_current(&app);
    let mut slot = state.player.lock().unwrap();
    // The in-app player stays running (idle, hidden behind the page) so the next
    // video starts without booting mpv again. A pop-out window is closed.
    let keep = slot.as_ref().map(|(_, embedded, p)| *embedded && p.alive()).unwrap_or(false);
    if keep {
        if let Some((_, _, p)) = slot.as_ref() {
            let _ = p.command(&["stop"]);
        }
    } else if let Some((_, _, p)) = slot.take() {
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

/// After saving a newer version of a picture, delete the older versions of it
/// (same name start and end, different version stamp in the middle).
fn prune_siblings(file: &std::path::Path, prefix: &str, suffix: &str) {
    let (Some(dir), Some(keep)) = (file.parent(), file.file_name().and_then(|n| n.to_str())) else { return };
    if prefix.is_empty() { return; }
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name != keep && name.starts_with(prefix) && name.ends_with(suffix) && name.len() > prefix.len() + suffix.len() {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

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
    // Seek preview frame: /bif/<item>/<n>
    if parts[0] == "bif" && parts.len() >= 3 {
        let n: usize = parts[2].parse().unwrap_or(usize::MAX);
        let guard = state.bif.lock().unwrap();
        if let Some((id, frames)) = guard.as_ref() {
            if id == parts[1] {
                if let Some(f) = frames.get(n) {
                    return img_response(StatusCode::OK, "image/jpeg", f.clone());
                }
            }
        }
        return not_found();
    }
    // Audiobookshelf book covers (/abs/<item id>?w=400&u=<updatedAt>) and author photos (/absa/<author id>?w=300&u=..)
    if parts[0] == "abs" || parts[0] == "absa" {
        return serve_abs_image(&state, parts[0] == "absa", parts[1], &parsed).await;
    }
    // Navidrome cover art: /nd/<coverArt id>?w=300
    if parts[0] == "nd" {
        return serve_nd_cover(&state, parts[1], &parsed).await;
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
                if !tag.is_empty() {
                    prune_siblings(&file, &format!("{}_{}_{}_", sanitize(item_id), sanitize(img_type), sanitize(index)), &format!("_{}", sanitize(&width)));
                }
                img_response(StatusCode::OK, sniff_mime(&b), b)
            }
            Err(_) => not_found(),
        },
        _ => not_found(),
    }
}

async fn serve_abs_image(state: &AppState, author: bool, id: &str, parsed: &reqwest::Url) -> Response<Vec<u8>> {
    let not_found = || img_response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    let q = |key: &str| parsed.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.to_string());
    let size = q("w").unwrap_or_else(|| "400".into());
    let stamp = q("u").unwrap_or_default();
    let kind = if author { "absa" } else { "abs" };
    let file = state.cache_dir.join("img").join(format!("{kind}_{}_{}_{}", sanitize(id), sanitize(&size), sanitize(&stamp)));
    if let Ok(bytes) = std::fs::read(&file) {
        return img_response(StatusCode::OK, sniff_mime(&bytes), bytes);
    }
    let cfg = state.cfg();
    if !cfg.abs_logged_in() {
        return not_found();
    }
    let url = if author {
        format!("{}/api/authors/{}/image?width={}&format=jpeg", cfg.abs_server, servers::enc(id), servers::enc(&size))
    } else {
        format!("{}/api/items/{}/cover?width={}&format=jpeg", cfg.abs_server, servers::enc(id), servers::enc(&size))
    };
    match state.http.get(url).bearer_auth(&cfg.abs_token).send().await {
        Ok(r) if r.status().is_success() && r.headers().get("content-type").map(|v| v.to_str().unwrap_or("").starts_with("image")).unwrap_or(false) => match r.bytes().await {
            Ok(b) => {
                let b = b.to_vec();
                if let Some(d) = file.parent() {
                    let _ = std::fs::create_dir_all(d);
                }
                let _ = std::fs::write(&file, &b);
                if !stamp.is_empty() {
                    prune_siblings(&file, &format!("{kind}_{}_{}_", sanitize(id), sanitize(&size)), "");
                }
                img_response(StatusCode::OK, sniff_mime(&b), b)
            }
            Err(_) => not_found(),
        },
        _ => not_found(),
    }
}

async fn serve_nd_cover(state: &AppState, id: &str, parsed: &reqwest::Url) -> Response<Vec<u8>> {
    let not_found = || img_response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    let size = parsed.query_pairs().find(|(k, _)| k == "w").map(|(_, v)| v.to_string()).unwrap_or_else(|| "300".into());
    let file = state.cache_dir.join("img").join(format!("nd_{}_{}", sanitize(id), sanitize(&size)));
    let cached = std::fs::read(&file).ok();
    let cfg = state.cfg();
    if let Some(bytes) = cached {
        // An artist picture saved before the album-cover fallback existed can be Navidrome's
        // grey placeholder: check it once more (the placeholder is fetched once per session).
        let stale = id.starts_with("ar-") && cfg.nd_logged_in() && nd_artist_placeholder(&state.http, &cfg, &size).await.as_deref() == Some(&bytes[..]);
        if !stale {
            return img_response(StatusCode::OK, sniff_mime(&bytes), bytes);
        }
    }
    if !cfg.nd_logged_in() {
        return not_found();
    }
    let got = nd_cover_bytes(&state.http, &cfg, id, &size).await;
    let got = if id.starts_with("ar-") { artist_fallback(state, &cfg, id, &size, got).await } else { got };
    match got {
        Some(b) => {
            if let Some(d) = file.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(&file, &b);
            // Navidrome picture ids end in a version stamp ("al-123_65a1b2c3"): drop older versions.
            if let Some((base, ver)) = id.rsplit_once('_') {
                if ver != "0" && !base.is_empty() {
                    prune_siblings(&file, &format!("nd_{}_", sanitize(base)), &format!("_{}", sanitize(&size)));
                }
            }
            img_response(StatusCode::OK, sniff_mime(&b), b)
        }
        None => not_found(),
    }
}

/// One picture from Navidrome, or None when it doesn't send an image.
async fn nd_cover_bytes(http: &reqwest::Client, cfg: &Config, id: &str, size: &str) -> Option<Vec<u8>> {
    let url = servers::nd_url(cfg, "getCoverArt", &format!("id={}&size={}", servers::enc(id), servers::enc(size)));
    let r = http.get(url).timeout(std::time::Duration::from_secs(20)).send().await.ok()?;
    let is_img = r.headers().get("content-type").map(|v| v.to_str().unwrap_or("").starts_with("image")).unwrap_or(false);
    if !r.status().is_success() || !is_img { return None; }
    r.bytes().await.ok().map(|b| b.to_vec())
}

/// Navidrome's "no artist picture" placeholder at a given size, fetched once by asking
/// for an artist that doesn't exist.
async fn nd_artist_placeholder(http: &reqwest::Client, cfg: &Config, size: &str) -> Option<Vec<u8>> {
    static SEEN: std::sync::OnceLock<Mutex<HashMap<String, Option<Vec<u8>>>>> = std::sync::OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashMap::new()));
    let key = format!("{}|{}", cfg.nd_server, size);
    if let Some(v) = seen.lock().unwrap().get(&key) { return v.clone(); }
    let v = nd_cover_bytes(http, cfg, "ar-scrappy-no-such-artist", size).await;
    seen.lock().unwrap().insert(key, v.clone());
    v
}

/// When an artist has no picture of its own (Navidrome sends nothing or its grey placeholder),
/// use the cover of the artist's most played album instead.
async fn artist_fallback(state: &AppState, cfg: &Config, id: &str, size: &str, got: Option<Vec<u8>>) -> Option<Vec<u8>> {
    let placeholder = nd_artist_placeholder(&state.http, cfg, size).await;
    let mut missing = match (&got, &placeholder) {
        (None, _) => true,
        (Some(b), Some(p)) => b == p,
        _ => false,
    };
    let artist_id = id.trim_start_matches("ar-").split('_').next().unwrap_or("");
    if artist_id.is_empty() { return got; }
    if !missing {
        // Last.fm's grey star counts as no picture too (Navidrome passes it through from Last.fm).
        const LASTFM_STAR: &str = "2a96cbd8b46e442fc41c2b86b821562f";
        if let Ok(info) = servers::nd_get(&state.http, cfg, "getArtistInfo2", &format!("id={}", servers::enc(artist_id))).await {
            let i = &info["artistInfo2"];
            missing = ["smallImageUrl", "mediumImageUrl", "largeImageUrl"].iter().any(|k| i[*k].as_str().map(|u| u.contains(LASTFM_STAR)).unwrap_or(false));
        }
    }
    if !missing { return got; }
    let Ok(v) = servers::nd_get(&state.http, cfg, "getArtist", &format!("id={}", servers::enc(artist_id))).await else { return got };
    let albums = v["artist"]["album"].as_array().cloned().unwrap_or_default();
    let best = albums.iter()
        .filter(|a| a["coverArt"].as_str().map(|c| !c.is_empty()).unwrap_or(false))
        .max_by_key(|a| (a["playCount"].as_i64().unwrap_or(0), a["songCount"].as_i64().unwrap_or(0)));
    match best.and_then(|a| a["coverArt"].as_str()) {
        Some(cv) => nd_cover_bytes(&state.http, cfg, cv, size).await.or(got),
        None => got,
    }
}

/// Quick Scan for Music: Navidrome pictures without a version stamp (mostly artist photos,
/// ids ending in "_0") can change without their id changing. Ask Navidrome about each saved
/// one ("changed since I saved it?") and only keep a new copy when the picture really changed.
/// Returns how many pictures were updated.
#[tauri::command]
async fn refresh_covers(state: State<'_, AppState>, kind: String) -> Result<u32, String> {
    if kind != "music" { return Ok(0); }
    let cfg = state.cfg();
    if !cfg.nd_logged_in() { return Ok(0); }
    let dir = state.cache_dir.join("img");
    let mut todo: Vec<(std::path::PathBuf, String, String, std::time::SystemTime)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(rest) = name.strip_prefix("nd_") else { continue };
            let Some((id, size)) = rest.rsplit_once('_') else { continue };
            let stamped = id.rsplit_once('_').map(|(_, v)| v != "0" && v.chars().all(|c| c.is_ascii_hexdigit())).unwrap_or(false);
            if stamped { continue; }
            let mtime = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            todo.push((e.path(), id.to_string(), size.to_string(), mtime));
        }
    }
    todo.sort_by(|a, b| b.3.cmp(&a.3));
    todo.truncate(600);
    let mut changed = 0u32;
    for (path, id, size, mtime) in todo {
        let url = servers::nd_url(&cfg, "getCoverArt", &format!("id={}&size={}", servers::enc(&id), servers::enc(&size)));
        let since = httpdate(mtime);
        let Ok(r) = state.http.get(url).header("If-Modified-Since", since).timeout(std::time::Duration::from_secs(15)).send().await else { continue };
        if r.status() == StatusCode::NOT_MODIFIED || !r.status().is_success() { continue; }
        if !r.headers().get("content-type").map(|v| v.to_str().unwrap_or("").starts_with("image")).unwrap_or(false) { continue; }
        let Ok(b) = r.bytes().await else { continue };
        let b = if id.starts_with("ar-") {
            match artist_fallback(&state, &cfg, &id, &size, Some(b.to_vec())).await { Some(x) => x, None => continue }
        } else { b.to_vec() };
        let old = std::fs::read(&path).unwrap_or_default();
        if old != b {
            let _ = std::fs::write(&path, &b);
            changed += 1;
        } else {
            // Same picture: touch it so the next check can be answered with "not changed".
            let _ = std::fs::write(&path, &b);
        }
    }
    Ok(changed)
}

/// A time as an HTTP date ("Sun, 09 Nov 2026 14:00:00 GMT").
fn httpdate(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil date from days since 1970-01-01 (Howard Hinnant's method).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    let mn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(mo - 1) as usize];
    format!("{wd}, {d:02} {mn} {y} {h:02}:{m:02}:{s:02} GMT")
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
        // Only one Scrappy at a time: starting it again brings the open window to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| appset::show_main(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Ready::default())
        .register_asynchronous_uri_scheme_protocol("img", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                responder.respond(serve_image(app, uri).await);
            });
        })
        .setup(|app| {
            let _ = emby::APP_VERSION.set(app.package_info().version.to_string());
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
                music: Mutex::new(None),
                now: Mutex::new(None),
                bif: Mutex::new(None),
            });

            // Tray icon (closing can keep music playing); started by Windows: stay in the tray.
            let _ = appset::make_tray(app.handle());
            if appset::started_hidden() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

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
            // The Follow along pop-out closed: tell the main window to show the text again.
            if window.label() == "follow" {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window.app_handle().emit_to("main", "fa-popin", ());
                }
                return;
            }
            // Closing the app mid-video: save the resume point first.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Settings: closing hides to the tray and music keeps playing (a video stops).
                let to_tray = window.label() == "main" && appset::CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed);
                if to_tray {
                    api.prevent_close();
                }
                if let Some(w) = window.app_handle().get_webview_window("follow") {
                    let _ = w.destroy();
                }
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
                if to_tray {
                    let _ = window.app_handle().emit_to("main", "player-closed", json!({}));
                    let _ = window.hide();
                    return;
                }
                music::quit(&app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            updates::app_version,
            updates::upd_check,
            updates::upd_install,
            set_zoom,
            get_session,
            login,
            logout,
            server_check,
            server_login,
            server_logout,
            nd_get,
            nd_cached,
            abs_get,
            abs_cached,
            abs_send,
            req_call,
            req_address,
            req_set_address,
            refresh_covers,
            music::book_play,
            follow::fa_info,
            follow::fa_start,
            follow::fa_pos,
            follow::fa_stop,
            follow::fa_cached,
            follow::fa_saved,
            follow::fa_clear,
            fa_popout,
            fa_popin,
            nd_playlist_image,
            nd_reauth,
            lyrics_find,
            nd_native_get,
            music::music_play,
            music::nd_snippet_url,
            music::music_upnext,
            music::music_command,
            music::music_set,
            music::music_get,
            music::music_stop,
            music::music_viz,
            api_get,
            api_cached,
            api_send,
            api_upload_image,
            save_png,
            load_previews,
            play,
            player_command,
            player_add_sub,
            player_set,
            player_get,
            stop_playback,
            set_fullscreen,
            is_fullscreen,
            clear_cache,
            appset::set_close_to_tray,
            appset::autostart_get,
            appset::autostart_set,
            appset::cache_size,
            appset::cache_trim
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scrappy");
}
