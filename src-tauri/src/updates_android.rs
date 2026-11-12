//! On the TV: app updates. For now these only report the version; checking for and
//! installing a new TV build comes with the in-app updater.
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Default)]
pub struct Ready;

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn upd_check(app: AppHandle, channel: String) -> Result<Value, String> {
    let _ = channel;
    Ok(json!({ "available": false, "current": app.package_info().version.to_string() }))
}

#[tauri::command]
pub async fn upd_install(_app: AppHandle, _channel: String) -> Result<(), String> {
    Err("Updates on the TV aren't ready yet.".into())
}
