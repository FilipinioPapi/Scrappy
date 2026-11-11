//! Auto-updates from GitHub Releases. Each channel has a latest.json next to its download:
//! Stable = the "latest" release (built from main), Preview = the "preview" release.
//! A found update downloads in the background and is kept on disk (signature checked on
//! download), so it can install straight away from "Restart now" or at the next start.
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

const BASE: &str = "https://github.com/FilipinioPapi/Scrappy/releases/download";

fn updater(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let tag = if channel == "preview" { "preview" } else { "latest" };
    let url = format!("{BASE}/{tag}/latest.json").parse().map_err(|e| format!("{e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

fn saved(app: &AppHandle, version: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("scrappy-{}.exe", version.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "_"))))
}

/// Remove downloads other than `keep` (older versions, or everything when up to date).
fn tidy(app: &AppHandle, keep: Option<&std::path::Path>) {
    let Ok(dir) = app.path().app_cache_dir().map(|d| d.join("updates")) else { return };
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if Some(e.path().as_path()) != keep {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Look for an update and download it if needed.
/// Returns { available, current, version?, date?, notes?, wasSaved? }.
/// wasSaved = it was already downloaded before this check (e.g. in an earlier session).
#[tauri::command]
pub async fn upd_check(app: AppHandle, channel: String) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    let Some(u) = updater(&app, &channel)?.check().await.map_err(|e| e.to_string())? else {
        tidy(&app, None);
        return Ok(json!({ "available": false, "current": current }));
    };
    let path = saved(&app, &u.version)?;
    let was_saved = path.exists();
    if !was_saved {
        let bytes = u.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        let tmp = path.with_extension("part");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }
    tidy(&app, Some(&path));
    Ok(json!({
        "available": true, "current": current, "version": u.version,
        "date": u.date.map(|d| d.unix_timestamp() * 1000),
        "notes": u.body, "wasSaved": was_saved,
    }))
}

/// Install the downloaded update. The installer runs quietly, then opens Scrappy again.
#[tauri::command]
pub async fn upd_install(app: AppHandle, channel: String) -> Result<(), String> {
    let u = updater(&app, &channel)?.check().await.map_err(|e| e.to_string())?.ok_or("Already up to date.")?;
    let path = saved(&app, &u.version)?;
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => u.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?,
    };
    crate::music::quit(&app);
    u.install(bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    app.restart();
}
