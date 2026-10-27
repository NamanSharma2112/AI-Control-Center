//! Self-update, through GitHub Releases.
//!
//! Present only in builds made with an update signing key; anywhere else the
//! commands report that updates are not available, and the webview hides the
//! controls. An update is verified against the public key compiled into the
//! app before it is installed, so a tampered download is refused.

use serde::Serialize;
use tauri::AppHandle;

/// Set at compile time by the release workflow when updates are configured.
pub const ENABLED: bool = option_env!("ACC_UPDATER").is_some();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

/// Asks the release endpoint whether a newer version exists. The request
/// carries no user data: it fetches one static JSON file.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !ENABLED {
        return Err("Updates are not available in this build.".into());
    }
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check for updates: {e}"))?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
    }))
}

/// Downloads, verifies and installs the update, then restarts into it.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !ENABLED {
        return Err("Updates are not available in this build.".into());
    }
    use tauri_plugin_updater::UpdaterExt;
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update failed: {e}"))?;
    app.restart();
}
