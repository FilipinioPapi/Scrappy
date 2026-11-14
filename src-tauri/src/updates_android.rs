//! On the TV: app updates without the Downloader app.
//! Every TV build publishes a small tv.json next to its Scrappy-TV.apk on GitHub Releases.
//! Scrappy reads it at start; if it names a newer version, the page asks "Update now?",
//! this file downloads the new app into Scrappy's own cache folder, and the TV's installer
//! takes over (UpdatePlugin.kt). Android itself refuses any file that wasn't signed with the
//! same key as the installed app, so only real Scrappy builds can install.
use serde_json::{json, Value};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// (Only the PC keeps a downloaded update in memory.)
#[derive(Default)]
pub struct Ready;

const BASE: &str = "https://github.com/FilipinioPapi/Scrappy/releases/download";
/// Which release this build updates from: "tv-preview" (test builds) or "tv" (from main).
const CHANNEL: &str = match option_env!("SCRAPPY_TV_CHANNEL") {
    Some(c) => c,
    None => "tv-preview",
};

static INSTALLER: OnceLock<PluginHandle<Wry>> = OnceLock::new();
static CANCEL: AtomicBool = AtomicBool::new(false);
static BUSY: AtomicBool = AtomicBool::new(false);

/// Registers the TV's installer hand-off (UpdatePlugin.kt) with the app.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("tvupdate")
        .setup(|_app, api| {
            let h = api.register_android_plugin("app.scrappy.player", "UpdatePlugin")?;
            let _ = INSTALLER.set(h);
            Ok(())
        })
        .build()
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// The PC's update buttons do nothing on the TV; the TV has its own (tv_update below).
#[tauri::command]
pub async fn upd_check(app: AppHandle, channel: String) -> Result<Value, String> {
    let _ = channel;
    Ok(json!({ "available": false, "current": app.package_info().version.to_string() }))
}

#[tauri::command]
pub async fn upd_install(_app: AppHandle, _channel: String) -> Result<(), String> {
    Err("Use the TV's update screen.".into())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// "0.3.15" -> [0, 3, 15], so versions compare as numbers.
fn nums(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.trim().parse().unwrap_or(0)).collect()
}

fn apk_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("Scrappy-TV.apk"))
}

async fn latest() -> Result<Value, String> {
    let r = client()?
        .get(format!("{BASE}/{CHANNEL}/tv.json"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("The update list answered {}.", r.status().as_u16()));
    }
    r.json::<Value>().await.map_err(|e| e.to_string())
}

/// The TV's updater. `what` is one of:
/// - "check":    { available, current, version?, notes?, size? }
/// - "download": fetches the new app, sending "tv-upd" events { got, total } as it goes
/// - "cancel":   stops a download
/// - "install":  hands the downloaded app to the TV's installer
/// - "restart":  closes Scrappy and opens it again
#[tauri::command]
pub async fn tv_update(app: AppHandle, what: String) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    match what.as_str() {
        "check" => {
            let j = latest().await?;
            let version = j["version"].as_str().unwrap_or("").to_string();
            let newer = !version.is_empty() && nums(&version) > nums(&current);
            if !newer {
                // Up to date: an old download is no longer needed.
                if let Ok(p) = apk_path(&app) {
                    let _ = std::fs::remove_file(p);
                }
            }
            Ok(json!({ "available": newer, "current": current, "version": version, "notes": j["notes"], "size": j["size"] }))
        }
        "download" => {
            if BUSY.swap(true, Ordering::SeqCst) {
                return Err("Already downloading.".into());
            }
            CANCEL.store(false, Ordering::SeqCst);
            let res = download(&app).await;
            BUSY.store(false, Ordering::SeqCst);
            if res.is_err() {
                if let Ok(p) = apk_path(&app) {
                    let _ = std::fs::remove_file(p);
                }
            }
            res
        }
        "cancel" => {
            CANCEL.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        }
        "install" => {
            let path = apk_path(&app)?;
            if !path.exists() {
                return Err("The update isn't downloaded yet.".into());
            }
            let h = INSTALLER.get().ok_or("The TV's installer isn't ready.")?;
            h.run_mobile_plugin::<Value>("install", json!({ "path": path.to_string_lossy() })).map_err(|e| e.to_string())
        }
        // Settings: "Restart Scrappy" closes the app completely and opens it again.
        "restart" => {
            let h = INSTALLER.get().ok_or("The TV isn't ready to restart Scrappy.")?;
            h.run_mobile_plugin::<Value>("restart", json!({})).map_err(|e| e.to_string())
        }
        // "Player details" in the player's settings.
        "playerlog" => {
            let h = INSTALLER.get().ok_or("Not ready.")?;
            h.run_mobile_plugin::<Value>("playerlog", json!({})).map_err(|e| e.to_string())
        }
        _ => Err("Unknown update step.".into()),
    }
}

async fn download(app: &AppHandle) -> Result<Value, String> {
    let j = latest().await?;
    let want = j["size"].as_u64().unwrap_or(0);
    let url = j["url"].as_str().map(str::to_string).unwrap_or_else(|| format!("{BASE}/{CHANNEL}/Scrappy-TV.apk"));
    // Only ever fetch Scrappy's own release files.
    if !url.starts_with(&format!("{BASE}/")) {
        return Err("The update list points somewhere unexpected.".into());
    }
    let path = apk_path(app)?;
    let part = path.with_extension("part");
    let mut r = client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("The download answered {}.", r.status().as_u16()));
    }
    let total = r.content_length().filter(|n| *n > 0).unwrap_or(want);
    let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let (mut got, mut told) = (0u64, std::time::Instant::now());
    let _ = app.emit("tv-upd", json!({ "got": 0, "total": total }));
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            drop(f);
            let _ = std::fs::remove_file(&part);
            return Err("cancelled".into());
        }
        let Some(chunk) = r.chunk().await.map_err(|e| e.to_string())? else { break };
        f.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if told.elapsed().as_millis() >= 200 {
            told = std::time::Instant::now();
            let _ = app.emit("tv-upd", json!({ "got": got, "total": total }));
        }
    }
    f.flush().map_err(|e| e.to_string())?;
    drop(f);
    if want > 0 && got != want {
        let _ = std::fs::remove_file(&part);
        return Err("The download came through incomplete. Try again.".into());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    let _ = app.emit("tv-upd", json!({ "got": got, "total": got }));
    Ok(json!({ "size": got }))
}
