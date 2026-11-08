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
    player: Mutex<Option<mpv::Session>>,
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

#[tauri::command]
async fn play(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: String,
    from_start: Option<bool>,
) -> Result<(), String> {
    let cfg = state.cfg();
    let item = emby::get(&state.http, &cfg, &format!("/Users/{{userId}}/Items/{item_id}")).await?;
    let start_ticks = if from_start.unwrap_or(false) {
        0
    } else {
        item["UserData"]["PlaybackPositionTicks"].as_i64().unwrap_or(0)
    };
    let target = emby::playback_target(&state.http, &cfg, &item_id, start_ticks).await?;

    let title = match item["Type"].as_str() {
        Some("Episode") => format!(
            "{} - S{:02}E{:02} - {}",
            item["SeriesName"].as_str().unwrap_or(""),
            item["ParentIndexNumber"].as_i64().unwrap_or(0),
            item["IndexNumber"].as_i64().unwrap_or(0),
            item["Name"].as_str().unwrap_or("")
        ),
        _ => item["Name"].as_str().unwrap_or("Scrappy").to_string(),
    };

    // Only one video at a time: close whatever is already playing.
    if let Some(old) = state.player.lock().unwrap().take() {
        old.quit();
    }

    let req = mpv::PlayRequest {
        url: target.url,
        title,
        start_seconds: start_ticks as f64 / 10_000_000.0,
    };
    let app2 = app.clone();
    let id2 = item_id.clone();
    let session = mpv::play(&state.mpv_dirs, req, move |ended| {
        let _ = app2.emit("player-ended", json!({ "itemId": id2, "error": ended.error }));
    })?;
    *state.player.lock().unwrap() = Some(session);
    let _ = app.emit(
        "player-started",
        json!({ "itemId": item_id, "playMethod": target.play_method }),
    );
    let _ = (target.media_source_id, target.play_session_id); // used for progress sync in step 2
    Ok(())
}

#[tauri::command]
fn stop_playback(state: State<'_, AppState>) {
    if let Some(s) = state.player.lock().unwrap().take() {
        s.quit();
    }
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_session,
            login,
            logout,
            api_get,
            api_cached,
            play,
            stop_playback,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scrappy");
}
