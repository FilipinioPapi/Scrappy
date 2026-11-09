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
pub async fn nd_login(http: &reqwest::Client, server: &str, user: &str, pass: &str) -> Result<(String, String, String), String> {
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
    Ok((name, salt, token))
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
