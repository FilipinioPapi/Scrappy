//! Auto-updates from GitHub Releases. Each channel has a latest.json next to its download:
//! Stable = the "latest" release (built from main), Preview = the "preview" release.
//! A found update downloads in the background (signature checked by the plugin) and stays in
//! memory, so "Restart now" installs at once. A small marker file remembers that this version
//! was ready; at the next start it's downloaded again (and checked again) before installing,
//! so nothing is ever installed from a file that wasn't just verified.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The verified installer from this session: (version, bytes).
#[derive(Default)]
pub struct Ready(pub Mutex<Option<(String, Vec<u8>)>>);
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
    Ok(dir.join(format!("ready-{}.txt", version.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "_"))))
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
    let have = app.state::<Ready>().0.lock().unwrap().as_ref().map(|(v, _)| v == &u.version).unwrap_or(false);
    if !have && !was_saved {
        let bytes = u.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        *app.state::<Ready>().0.lock().unwrap() = Some((u.version.clone(), bytes));
        std::fs::write(&path, &u.version).map_err(|e| e.to_string())?;
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
    let mem = app.state::<Ready>().0.lock().unwrap().take().filter(|(v, _)| v == &u.version).map(|(_, b)| b);
    let bytes = match mem {
        Some(b) => b,
        None => u.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?,
    };
    finish(&app, u, bytes, &path)
}

/// Windows: run the installer ourselves, so a blocked installer (removed by antivirus, or not
/// allowed to start) is reported in the app instead of Scrappy closing and never coming back.
#[cfg(windows)]
fn finish(app: &AppHandle, u: tauri_plugin_updater::Update, bytes: Vec<u8>, saved_marker: &std::path::Path) -> Result<(), String> {
    let exe = write_installer(&u.version, &bytes)?;
    crate::music::quit(app);
    crate::follow::shutdown();
    // /S quiet, /UPDATE keep settings, /R open Scrappy again when done.
    if let Err(e) = std::process::Command::new(&exe).args(["/S", "/UPDATE", "/R"]).spawn() {
        return Err(format!("BLOCKED Windows didn't let the installer start ({e})."));
    }
    let _ = std::fs::remove_file(saved_marker);
    std::process::exit(0)
}

#[cfg(not(windows))]
fn finish(app: &AppHandle, u: tauri_plugin_updater::Update, bytes: Vec<u8>, saved_marker: &std::path::Path) -> Result<(), String> {
    crate::music::quit(app);
    crate::follow::shutdown();
    u.install(bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(saved_marker);
    app.restart()
}

/// Save the (already signature-checked) installer to a temp folder and make sure it's
/// still there a moment later: antivirus that doesn't trust it deletes it straight away.
#[cfg(windows)]
fn write_installer(version: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    let safe: String = version.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' }).collect();
    let dir = std::env::temp_dir().join(format!("scrappy-update-{safe}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = dir.join(format!("Scrappy-{safe}-setup.exe"));
    std::fs::write(&exe, bytes).map_err(|e| format!("BLOCKED Couldn't save the installer ({e})."))?;
    std::thread::sleep(std::time::Duration::from_millis(1200));
    match std::fs::metadata(&exe) {
        Ok(m) if m.len() == bytes.len() as u64 => Ok(exe),
        _ => Err("BLOCKED Windows Security removed the installer before it could run.".into()),
    }
}

/// Open the release page in the browser, to download the installer by hand.
#[tauri::command]
pub fn upd_open_page(channel: String) {
    let tag = if channel == "preview" { "preview" } else { "latest" };
    let url = format!("https://github.com/FilipinioPapi/Scrappy/releases/tag/{tag}");
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(url).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = url;
    }
}
