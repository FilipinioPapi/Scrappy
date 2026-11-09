//! The other two servers: Navidrome (music) and Audiobookshelf (audiobooks).
//! Like Emby, addresses come from the sign-in screen and only tokens are saved.

use crate::emby::{friendly_error, normalize_server, Config, CLIENT_NAME};
use serde_json::{json, Value};

pub const SUBSONIC_VERSION: &str = "1.16.1";

impl Config {
    pub fn nd_logged_in(&self) -> bool {
        !self.nd_server.is_empty() && !self.nd_token.is_empty()
    }
    pub fn abs_logged_in(&self) -> bool {
        !self.abs_server.is_empty() && !self.abs_token.is_empty()
    }
    /// The login part of every Navidrome (Subsonic API) request.
    pub fn nd_auth_query(&self) -> String {
        format!(
            "u={}&t={}&s={}&v={SUBSONIC_VERSION}&c={}&f=json",
            enc(&self.nd_user),
            enc(&self.nd_token),
            enc(&self.nd_salt),
            enc(CLIENT_NAME)
        )
    }
}

pub fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------- Navidrome ----------

/// Look for Navidrome at the address. Subsonic answers ping even without a login.
pub async fn nd_find(http: &reqwest::Client, input: &str) -> Result<(String, String), String> {
    let base = normalize_server(input);
    let mut last_err = String::new();
    for candidate in [base.clone(), format!("{base}/navidrome"), format!("{base}/music")] {
        match http.get(format!("{candidate}/rest/ping.view?f=json&v={SUBSONIC_VERSION}&c=Scrappy")).send().await {
            Ok(r) => {
                let v: Value = r.json().await.unwrap_or(Value::Null);
                let sr = &v["subsonic-response"];
                if sr.is_object() {
                    let name = match sr["type"].as_str() {
                        Some("navidrome") | None => "Navidrome".to_string(),
                        Some(t) => t.to_string(),
                    };
                    return Ok((candidate, name));
                }
                last_err = "That address answered, but it doesn't look like Navidrome.".into();
            }
            Err(e) => last_err = friendly_error(e),
        }
    }
    Err(last_err)
}

/// Navidrome's own login hands back a ready-made Subsonic salt and token.
pub async fn nd_login(http: &reqwest::Client, server: &str, user: &str, pass: &str) -> Result<(String, String, String, String), String> {
    let r = http
        .post(format!("{server}/auth/login"))
        .json(&json!({ "username": user, "password": pass }))
        .send()
        .await
        .map_err(friendly_error)?;
    if r.status().as_u16() == 401 {
        return Err("Wrong username or password.".into());
    }
    if !r.status().is_success() {
        return Err(format!("Sign-in failed ({}).", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let salt = v["subsonicSalt"].as_str().unwrap_or_default().to_string();
    let token = v["subsonicToken"].as_str().unwrap_or_default().to_string();
    let name = v["username"].as_str().unwrap_or(user).to_string();
    if salt.is_empty() || token.is_empty() {
        return Err("Navidrome didn't return a login token.".into());
    }
    let jwt = v["token"].as_str().unwrap_or_default().to_string();
    Ok((name, salt, token, jwt))
}

/// Change or remove a playlist's cover with Navidrome's own API (Navidrome 0.61+).
/// Returns a refreshed session token when Navidrome sends one.
pub async fn nd_playlist_image(http: &reqwest::Client, cfg: &Config, id: &str, image: Option<(Vec<u8>, String)>) -> Result<Option<String>, String> {
    if cfg.nd_jwt.is_empty() {
        return Err("ND_NATIVE_EXPIRED".into());
    }
    let url = format!("{}/api/playlist/{}/image", cfg.nd_server, enc(id));
    let req = match image {
        Some((bytes, name)) => {
            let mime = if name.ends_with(".png") { "image/png" } else if name.ends_with(".webp") { "image/webp" } else if name.ends_with(".gif") { "image/gif" } else { "image/jpeg" };
            let part = reqwest::multipart::Part::bytes(bytes).file_name(name).mime_str(mime).map_err(|e| e.to_string())?;
            http.post(url).multipart(reqwest::multipart::Form::new().part("image", part))
        }
        None => http.delete(url),
    };
    let r = req.header("X-ND-Authorization", format!("Bearer {}", cfg.nd_jwt)).send().await.map_err(friendly_error)?;
    let fresh = r.headers().get("x-nd-authorization").and_then(|h| h.to_str().ok()).map(|s| s.trim_start_matches("Bearer ").to_string());
    match r.status().as_u16() {
        200..=299 => Ok(fresh),
        401 => Err("ND_NATIVE_EXPIRED".into()),
        403 => Err("Navidrome doesn't allow changing this playlist's art (only its owner can, and artwork upload must be on).".into()),
        404 | 405 => Err("Your Navidrome is too old to change playlist art. It needs version 0.61 or newer.".into()),
        s => Err(format!("Navidrome couldn't save the image ({}).", s)),
    }
}

/// GET from Navidrome's own API (e.g. /api/scrobble). Returns (body, total from X-Total-Count, refreshed session token).
pub async fn nd_native_get(http: &reqwest::Client, cfg: &Config, path: &str) -> Result<(Value, i64, Option<String>), String> {
    if cfg.nd_jwt.is_empty() {
        return Err("ND_NATIVE_EXPIRED".into());
    }
    let r = http.get(format!("{}{}", cfg.nd_server, path))
        .header("X-ND-Authorization", format!("Bearer {}", cfg.nd_jwt))
        .send().await.map_err(friendly_error)?;
    let fresh = r.headers().get("x-nd-authorization").and_then(|h| h.to_str().ok()).map(|s| s.trim_start_matches("Bearer ").to_string());
    let total = r.headers().get("x-total-count").and_then(|h| h.to_str().ok()).and_then(|s| s.parse().ok()).unwrap_or(-1);
    match r.status().as_u16() {
        200..=299 => Ok((r.json().await.map_err(|e| e.to_string())?, total, fresh)),
        401 => Err("ND_NATIVE_EXPIRED".into()),
        404 | 405 => Err("ND_TOO_OLD".into()),
        s => Err(format!("Navidrome said {s}")),
    }
}

/// Look up lyrics on LRCLIB (free, no account). Prefers time-synced lyrics.
pub async fn lyrics_find(http: &reqwest::Client, artist: &str, title: &str, album: &str, duration: u64) -> Result<Value, String> {
    let ua = "Scrappy Media Center (personal music player)";
    let get = format!(
        "https://lrclib.net/api/get?artist_name={}&track_name={}&album_name={}&duration={}",
        enc(artist), enc(title), enc(album), duration
    );
    if let Ok(r) = http.get(&get).header("User-Agent", ua).send().await {
        if r.status().is_success() {
            if let Ok(v) = r.json::<Value>().await {
                if v["syncedLyrics"].is_string() || v["plainLyrics"].is_string() {
                    return Ok(v);
                }
            }
        }
    }
    let q = format!("https://lrclib.net/api/search?artist_name={}&track_name={}", enc(artist), enc(title));
    let r = http.get(&q).header("User-Agent", ua).send().await.map_err(friendly_error)?;
    let list: Value = r.json().await.map_err(|e| e.to_string())?;
    let items = list.as_array().cloned().unwrap_or_default();
    // Closest length wins; synced lyrics break ties.
    let best = items.into_iter()
        .filter(|v| v["syncedLyrics"].is_string() || v["plainLyrics"].is_string())
        .min_by_key(|v| {
            let d = (v["duration"].as_f64().unwrap_or(0.0) as i64 - duration as i64).abs();
            d * 2 + if v["syncedLyrics"].is_string() { 0 } else { 1 }
        });
    best.ok_or_else(|| "No lyrics found online for this song.".to_string())
}

/// Full URL for a Subsonic call, e.g. ("getAlbumList2", "type=newest&size=20").
pub fn nd_url(cfg: &Config, endpoint: &str, query: &str) -> String {
    let mut u = format!("{}/rest/{}?{}", cfg.nd_server, endpoint, cfg.nd_auth_query());
    if !query.is_empty() {
        u.push('&');
        u.push_str(query.trim_start_matches(['?', '&']));
    }
    u
}

pub async fn nd_get(http: &reqwest::Client, cfg: &Config, endpoint: &str, query: &str) -> Result<Value, String> {
    if !cfg.nd_logged_in() {
        return Err("Not signed in to Navidrome.".into());
    }
    let r = http.get(nd_url(cfg, endpoint, query)).send().await.map_err(friendly_error)?;
    if !r.status().is_success() {
        return Err(format!("Navidrome error ({}).", r.status()));
    }
    let mut v: Value = r.json().await.map_err(|e| e.to_string())?;
    let sr = v["subsonic-response"].take();
    if sr["status"].as_str() != Some("ok") {
        let code = sr["error"]["code"].as_i64().unwrap_or(0);
        if code == 40 || code == 41 || code == 44 {
            return Err("ND_SESSION_EXPIRED".into());
        }
        return Err(sr["error"]["message"].as_str().unwrap_or("Navidrome said no.").to_string());
    }
    Ok(sr)
}

// ---------- Audiobookshelf ----------

pub async fn abs_find(http: &reqwest::Client, input: &str) -> Result<(String, String), String> {
    let base = normalize_server(input);
    let mut last_err = String::new();
    for candidate in [base.clone(), format!("{base}/audiobookshelf")] {
        match http.get(format!("{candidate}/status")).send().await {
            Ok(r) if r.status().is_success() => {
                let v: Value = r.json().await.unwrap_or(Value::Null);
                if v.get("isInit").is_some() || v["app"].as_str() == Some("audiobookshelf") {
                    if v["isInit"].as_bool() == Some(false) {
                        return Err("Audiobookshelf is there, but it hasn't been set up yet. Open it in a browser first.".into());
                    }
                    return Ok((candidate, "Audiobookshelf".into()));
                }
                last_err = "That address answered, but it doesn't look like Audiobookshelf.".into();
            }
            Ok(r) => last_err = format!("The server answered with an error ({}).", r.status()),
            Err(e) => last_err = friendly_error(e),
        }
    }
    Err(last_err)
}

pub async fn abs_login(http: &reqwest::Client, server: &str, user: &str, pass: &str) -> Result<(String, String), String> {
    let r = http
        .post(format!("{server}/login"))
        .json(&json!({ "username": user, "password": pass }))
        .send()
        .await
        .map_err(friendly_error)?;
    if r.status().as_u16() == 401 {
        return Err("Wrong username or password.".into());
    }
    if !r.status().is_success() {
        return Err(format!("Sign-in failed ({}).", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let u = &v["user"];
    // The long-lived token; newer servers also send short-lived ones we don't need.
    let token = u["token"].as_str().or(u["accessToken"].as_str()).unwrap_or_default().to_string();
    let name = u["username"].as_str().unwrap_or(user).to_string();
    if token.is_empty() {
        return Err("Audiobookshelf didn't return a login token.".into());
    }
    Ok((name, token))
}

pub async fn abs_get(http: &reqwest::Client, cfg: &Config, path: &str) -> Result<Value, String> {
    if !cfg.abs_logged_in() {
        return Err("Not signed in to Audiobookshelf.".into());
    }
    let r = http
        .get(format!("{}{}", cfg.abs_server, path))
        .bearer_auth(&cfg.abs_token)
        .send()
        .await
        .map_err(friendly_error)?;
    if r.status().as_u16() == 401 {
        return Err("ABS_SESSION_EXPIRED".into());
    }
    if !r.status().is_success() {
        return Err(format!("Audiobookshelf error ({}).", r.status()));
    }
    r.json().await.map_err(|e| e.to_string())
}

/// POST / PATCH / DELETE to Audiobookshelf (playback sessions, progress).
pub async fn abs_send(http: &reqwest::Client, cfg: &Config, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    if !cfg.abs_logged_in() {
        return Err("Not signed in to Audiobookshelf.".into());
    }
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Bad method".to_string())?;
    let mut req = http.request(m, format!("{}{}", cfg.abs_server, path)).bearer_auth(&cfg.abs_token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let r = req.send().await.map_err(friendly_error)?;
    if r.status().as_u16() == 401 {
        return Err("ABS_SESSION_EXPIRED".into());
    }
    if !r.status().is_success() {
        return Err(format!("Audiobookshelf error ({}).", r.status()));
    }
    let text = r.text().await.map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// Full address for one of a book's audio files (Audiobookshelf accepts the token in the address).
pub fn abs_file_url(cfg: &Config, path: &str) -> String {
    let sep = if path.contains('?') { '&' } else { '?' };
    format!("{}{}{}token={}", cfg.abs_server, path, sep, enc(&cfg.abs_token))
}
