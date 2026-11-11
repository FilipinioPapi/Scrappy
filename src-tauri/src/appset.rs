//! Settings that need the app itself, not just the page: the tray icon (closing the window
//! keeps music playing), starting with Windows, and the size of the image cache.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

use crate::AppState;

/// Closing the main window hides it to the tray instead of quitting (set by the page).
pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_close_to_tray(on: bool) {
    CLOSE_TO_TRAY.store(on, Ordering::Relaxed);
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The tray icon: click to open Scrappy, right-click for Open / Quit.
pub fn make_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Scrappy", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Scrappy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut b = TrayIconBuilder::with_id("scrappy")
        .tooltip("Scrappy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => {
                // Quitting for real: the normal close clean-up runs, then the app ends.
                CLOSE_TO_TRAY.store(false, Ordering::Relaxed);
                match app.get_webview_window("main") {
                    Some(w) => {
                        let _ = w.close();
                    }
                    None => app.exit(0),
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}

// ---------- Open Scrappy when Windows starts ----------
// A value under the user's "Run" key, like most apps. "--hidden" starts it in the tray.

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(windows)]
fn reg(args: &[&str]) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(out.status.success())
}
#[cfg(not(windows))]
fn reg(_args: &[&str]) -> Result<bool, String> {
    Err("Only on Windows.".into())
}

#[tauri::command]
pub fn autostart_get() -> bool {
    reg(&["query", RUN_KEY, "/v", "Scrappy"]).unwrap_or(false)
}

#[tauri::command]
pub fn autostart_set(on: bool) -> Result<bool, String> {
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = format!("\"{}\" --hidden", exe.display());
        if !reg(&["add", RUN_KEY, "/v", "Scrappy", "/t", "REG_SZ", "/d", &cmd, "/f"])? {
            return Err("Windows didn't allow it.".into());
        }
    } else {
        let _ = reg(&["delete", RUN_KEY, "/v", "Scrappy", "/f"]);
    }
    Ok(autostart_get())
}

/// Started by Windows at sign-in: stay in the tray until opened.
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

// ---------- Image cache ----------

fn files(dir: &Path, out: &mut Vec<(PathBuf, u64, std::time::SystemTime)>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    out.push((e.path(), m.len(), m.modified().unwrap_or(std::time::UNIX_EPOCH)));
                }
            }
        }
    }
}

fn cache_files(state: &AppState) -> Vec<(PathBuf, u64, std::time::SystemTime)> {
    let mut v = Vec::new();
    files(&state.cache_dir.join("img"), &mut v);
    files(&state.cache_dir.join("meta"), &mut v);
    v
}

#[tauri::command]
pub fn cache_size(state: State<'_, AppState>) -> Value {
    let v = cache_files(&state);
    json!({ "bytes": v.iter().map(|f| f.1).sum::<u64>(), "files": v.len() })
}

/// Keep the cache under `max_mb` by removing the files used longest ago. 0 = no limit.
#[tauri::command]
pub fn cache_trim(state: State<'_, AppState>, max_mb: u64) -> Value {
    if max_mb == 0 {
        return cache_size(state);
    }
    let mut v = cache_files(&state);
    let max = max_mb * 1024 * 1024;
    let mut total: u64 = v.iter().map(|f| f.1).sum();
    if total > max {
        v.sort_by_key(|f| f.2);
        // Trim to 90% so it doesn't run again straight away.
        let goal = max / 10 * 9;
        for (p, len, _) in &v {
            if total <= goal {
                break;
            }
            if std::fs::remove_file(p).is_ok() {
                total = total.saturating_sub(*len);
            }
        }
    }
    cache_size(state)
}
