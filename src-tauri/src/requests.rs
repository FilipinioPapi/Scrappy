//! Talking to the request service (Scrappy's Request button).
//! It lives on the Emby address under /requests unless an address is set in Settings.

use crate::emby::Config;
use serde_json::Value;
use std::time::Duration;

pub fn base(cfg: &Config) -> String {
    if !cfg.requests_url.trim().is_empty() {
        return cfg.requests_url.trim().trim_end_matches('/').to_string();
    }
    let s = cfg.server.trim_end_matches('/');
    let s = s.strip_suffix("/emby").unwrap_or(s);
    format!("{s}/requests")
}

/// Call the service as the signed-in Emby user. Errors are plain sentences, except
/// "REQ_OFFLINE" (no service answering at that address) and "REQ_NO_EMBY".
pub async fn call(http: &reqwest::Client, cfg: &Config, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    if !cfg.logged_in() {
        return Err("REQ_NO_EMBY".into());
    }
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Bad method".to_string())?;
    let mut req = http
        .request(m, format!("{}{}", base(cfg), path))
        .header("X-Emby-Token", &cfg.token)
        .header("X-Emby-UserId", &cfg.user_id)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(45));
    if let Some(b) = body {
        req = req.json(&b);
    }
    let r = req.send().await.map_err(|_| "REQ_OFFLINE".to_string())?;
    let status = r.status();
    let text = r.text().await.unwrap_or_default();
    let json: Option<Value> = serde_json::from_str(&text).ok();
    match json {
        // Anything that isn't our JSON (a proxy's 404 page, Emby itself) means the service isn't there.
        None => Err("REQ_OFFLINE".into()),
        Some(v) if status.is_success() => Ok(v),
        Some(v) => Err(v["error"].as_str().map(String::from).unwrap_or_else(|| format!("The request service answered {status}."))),
    }
}
