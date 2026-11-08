//! Talking to the Emby server: login, saved session, and generic API calls.
//! Nothing about the server is hard-coded; it all comes from the login screen.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

pub const CLIENT_NAME: &str = "Scrappy Media Center";
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// What we remember between launches. The password is never stored, only the
/// access token Emby hands back after login.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub server: String,
    pub user_id: String,
    pub user_name: String,
    pub token: String,
    pub device_id: String,
    #[serde(default)]
    pub server_name: String,
}

impl Config {
    pub fn load(path: &PathBuf) -> Config {
        let mut cfg: Config = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if cfg.device_id.is_empty() {
            cfg.device_id = uuid::Uuid::new_v4().simple().to_string();
            let _ = cfg.save(path);
        }
        cfg
    }

    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let s = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, s).map_err(|e| e.to_string())
    }

    pub fn logged_in(&self) -> bool {
        !self.server.is_empty() && !self.token.is_empty() && !self.user_id.is_empty()
    }

    /// The header Emby uses to identify the app and the logged-in user.
    pub fn auth_header(&self) -> String {
        let mut h = format!(
            "Emby Client=\"{}\", Device=\"{}\", DeviceId=\"{}\", Version=\"{}\"",
            CLIENT_NAME,
            device_name(),
            self.device_id,
            CLIENT_VERSION
        );
        if !self.user_id.is_empty() {
            h.push_str(&format!(", UserId=\"{}\"", self.user_id));
        }
        if !self.token.is_empty() {
            h.push_str(&format!(", Token=\"{}\"", self.token));
        }
        h
    }
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Windows PC".into())
        .replace('"', "")
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(8)
        .build()
        .expect("http client")
}

/// Turn whatever the user typed ("192.168.1.10:8096", "https://emby.me/")
/// into a clean base URL.
pub fn normalize_server(input: &str) -> String {
    let mut s = input.trim().trim_end_matches('/').to_string();
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("http://{s}");
    }
    // If the user pasted the web app address, drop the web part.
    for suffix in ["/web/index.html", "/web"] {
        if let Some(stripped) = s.strip_suffix(suffix) {
            s = stripped.to_string();
        }
    }
    s
}

fn friendly_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The server took too long to answer.".into()
    } else if e.is_connect() {
        "Couldn't reach the server. Check the address and that the server is running.".into()
    } else {
        format!("Network error: {e}")
    }
}

/// Try the address as typed, then with "/emby" added (some setups need it).
pub async fn find_server(http: &reqwest::Client, input: &str) -> Result<(String, String), String> {
    let base = normalize_server(input);
    let mut last_err = String::new();
    for candidate in [base.clone(), format!("{base}/emby")] {
        match http
            .get(format!("{candidate}/System/Info/Public"))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                if let Ok(v) = r.json::<Value>().await {
                    if v.get("Id").is_some() || v.get("ServerName").is_some() {
                        let name = v["ServerName"].as_str().unwrap_or("Emby").to_string();
                        return Ok((candidate, name));
                    }
                }
                last_err = "That address answered, but it doesn't look like an Emby server.".into();
            }
            Ok(r) => last_err = format!("The server answered with an error ({}).", r.status()),
            Err(e) => last_err = friendly_error(e),
        }
    }
    Err(last_err)
}

pub async fn authenticate(
    http: &reqwest::Client,
    cfg: &Config,
    server: &str,
    username: &str,
    password: &str,
) -> Result<(String, String), String> {
    let r = http
        .post(format!("{server}/Users/AuthenticateByName"))
        .header("X-Emby-Authorization", cfg.auth_header())
        .json(&json!({ "Username": username, "Pw": password }))
        .send()
        .await
        .map_err(friendly_error)?;
    if r.status().as_u16() == 401 {
        return Err("Wrong username or password.".into());
    }
    if !r.status().is_success() {
        return Err(format!("Login failed ({}).", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let token = v["AccessToken"].as_str().unwrap_or_default().to_string();
    let user_id = v["User"]["Id"].as_str().unwrap_or_default().to_string();
    if token.is_empty() || user_id.is_empty() {
        return Err("The server didn't return a login token.".into());
    }
    Ok((token, user_id))
}

/// Replace "{userId}" in a path so the UI doesn't need to know the id.
pub fn expand_path(cfg: &Config, path: &str) -> String {
    path.replace("{userId}", &cfg.user_id)
}

pub async fn get(http: &reqwest::Client, cfg: &Config, path: &str) -> Result<Value, String> {
    send(http, cfg, reqwest::Method::GET, path, None).await
}

pub async fn send(
    http: &reqwest::Client,
    cfg: &Config,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    if !cfg.logged_in() {
        return Err("Not logged in.".into());
    }
    let url = format!("{}{}", cfg.server, expand_path(cfg, path));
    let mut req = http
        .request(method, url)
        .header("X-Emby-Authorization", cfg.auth_header())
        .header("X-Emby-Token", &cfg.token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let r = req.send().await.map_err(friendly_error)?;
    let status = r.status();
    if status.as_u16() == 401 {
        return Err("SESSION_EXPIRED".into());
    }
    if !status.is_success() {
        return Err(format!("Server error ({status})."));
    }
    let text = r.text().await.map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// A device profile that tells Emby "mpv can play basically anything",
/// so the server direct-plays whenever it can and only transcodes if it must.
pub fn device_profile(max_bitrate: u64) -> Value {
    let sub = |fmt: &str, method: &str| json!({ "Format": fmt, "Method": method });
    let mut subs = Vec::new();
    for f in ["srt", "subrip", "ass", "ssa", "vtt", "webvtt", "sub", "smi", "ttml"] {
        subs.push(sub(f, "External"));
    }
    for f in [
        "srt", "subrip", "ass", "ssa", "vtt", "webvtt", "pgs", "pgssub", "dvdsub", "dvbsub",
        "vobsub", "mov_text",
    ] {
        subs.push(sub(f, "Embed"));
    }
    json!({
        "Name": "Scrappy (mpv)",
        "MaxStreamingBitrate": max_bitrate,
        "MaxStaticBitrate": max_bitrate,
        "MusicStreamingTranscodingBitrate": 320000,
        "DirectPlayProfiles": [ { "Type": "Video" }, { "Type": "Audio" } ],
        "TranscodingProfiles": [{
            "Container": "ts",
            "Type": "Video",
            "VideoCodec": "h264,hevc",
            "AudioCodec": "aac,ac3,eac3,mp3,opus,flac",
            "Context": "Streaming",
            "Protocol": "hls",
            "MaxAudioChannels": "8",
            "BreakOnNonKeyFrames": true
        }],
        "ContainerProfiles": [],
        "CodecProfiles": [],
        "SubtitleProfiles": subs,
        "ResponseProfiles": []
    })
}

pub struct PlayTarget {
    pub url: String,
    pub play_method: String,
    pub media_source_id: String,
    pub play_session_id: String,
}

/// Ask Emby how to play an item and build the stream URL for mpv.
pub async fn playback_target(
    http: &reqwest::Client,
    cfg: &Config,
    item_id: &str,
    start_ticks: i64,
) -> Result<PlayTarget, String> {
    let max_bitrate: u64 = 200_000_000;
    let path = format!(
        "/Items/{item_id}/PlaybackInfo?UserId={}&StartTimeTicks={start_ticks}&IsPlayback=true&AutoOpenLiveStream=true&MaxStreamingBitrate={max_bitrate}",
        cfg.user_id
    );
    let info = send(
        http,
        cfg,
        reqwest::Method::POST,
        &path,
        Some(json!({ "DeviceProfile": device_profile(max_bitrate) })),
    )
    .await?;

    if let Some(code) = info["ErrorCode"].as_str() {
        return Err(format!("Emby can't play this item ({code})."));
    }
    let play_session_id = info["PlaySessionId"].as_str().unwrap_or_default().to_string();
    let source = info["MediaSources"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or("Emby returned no playable version of this item.")?;
    let media_source_id = source["Id"].as_str().unwrap_or_default().to_string();

    let direct = source["SupportsDirectPlay"].as_bool().unwrap_or(false)
        || source["SupportsDirectStream"].as_bool().unwrap_or(false);

    // Remote items (e.g. .strm files pointing to a URL) are played straight from their URL.
    if direct
        && source["IsRemote"].as_bool().unwrap_or(false)
        && source["Protocol"].as_str() == Some("Http")
    {
        if let Some(p) = source["Path"].as_str() {
            return Ok(PlayTarget {
                url: p.to_string(),
                play_method: "DirectPlay".into(),
                media_source_id,
                play_session_id,
            });
        }
    }

    if direct {
        let container = source["Container"]
            .as_str()
            .and_then(|c| c.split(',').next())
            .unwrap_or("mkv");
        let url = format!(
            "{}/Videos/{item_id}/stream.{container}?Static=true&MediaSourceId={media_source_id}&DeviceId={}&PlaySessionId={play_session_id}&api_key={}",
            cfg.server, cfg.device_id, cfg.token
        );
        return Ok(PlayTarget {
            url,
            play_method: "DirectStream".into(),
            media_source_id,
            play_session_id,
        });
    }

    if let Some(t) = source["TranscodingUrl"].as_str() {
        let mut url = format!("{}{}", cfg.server, t);
        if !url.contains("api_key=") {
            url.push_str(&format!("&api_key={}", cfg.token));
        }
        return Ok(PlayTarget {
            url,
            play_method: "Transcode".into(),
            media_source_id,
            play_session_id,
        });
    }

    Err("Emby didn't offer a way to play this item.".into())
}
