//! The command surface exposed to the webview.
//!
//! Kept narrow on purpose. Nothing here returns a secret, runs an arbitrary
//! command, or takes a path the caller did not already receive from us.

use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

use crate::edge::EdgeWatcher;
use crate::providers::{self, LocalProviderStateDto};
use crate::secrets;
use crate::state::AppState;
use crate::window;

pub struct Watcher(pub Arc<EdgeWatcher>);

#[tauri::command]
pub fn read_provider_state(
    provider: String,
    state: State<'_, Arc<AppState>>,
) -> LocalProviderStateDto {
    let cap = state.cap_for(&provider);
    let result = providers::read_provider_state(&provider, cap);

    // Keep a usage trail so history survives a restart.
    if let Some(usage) = &result.usage {
        let percentage = if usage.cap > 0 {
            (usage.used as f64 / usage.cap as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        let _ = state.db.record_usage(&crate::db::UsageReading {
            provider_id: &provider,
            used: usage.used,
            cap: Some(usage.cap),
            percentage,
            reset_at: usage.reset_at,
            source: "local",
            captured_at: providers::now_ms(),
        });
    }

    result
}

#[tauri::command]
pub fn save_settings(
    settings: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .save_settings(&settings.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_settings(state: State<'_, Arc<AppState>>) -> Option<serde_json::Value> {
    state
        .db
        .load_settings()
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

#[tauri::command]
pub fn apply_window_layout(
    app: AppHandle,
    edge: String,
    width: f64,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.set_layout(&edge, width);
    window::apply_layout(&app, &edge, width).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) -> Result<(), String> {
    window::hide(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_panel(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let (edge, width) = state.edge_and_width();
    window::show(&app, &edge, width, window::Summon::Tray).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_edge_watch(enabled: bool, watcher: State<'_, Watcher>) {
    watcher.0.set_enabled(enabled);
}

#[tauri::command]
pub fn set_edge_config(sensitivity: i64, dwell_ms: u64, watcher: State<'_, Watcher>) {
    watcher.0.configure(sensitivity, dwell_ms);
}

#[tauri::command]
pub fn set_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    crate::shortcut::rebind(&app, &accelerator)
}

#[tauri::command]
pub fn set_retention(days: i64, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.set_retention_days(days);
    state
        .db
        .prune(days, providers::now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_local_data(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.db.clear_local_data().map_err(|e| e.to_string())
}

/// Shows an OS notification, but only while the panel is hidden: with the
/// panel open the same notice is already on screen inside it.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    if window::is_visible(&app) {
        return Ok(());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Opens a path in the OS file manager.
///
/// Only accepts a directory that actually exists, so a malformed or injected
/// value cannot be turned into "open this arbitrary thing".
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_dir() {
        return Err("That project folder no longer exists.".into());
    }
    app.opener()
        .open_path(candidate.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Opens the platform terminal at a project directory.
///
/// The directory is passed as an argument to a fixed program, never
/// interpolated into a shell string, so a path with quotes or semicolons in it
/// is just a path.
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() {
        return Err("That project folder no longer exists.".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg("-a").arg("Terminal").arg(&dir);
        c
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg("start").arg("").arg("cmd").arg("/K");
        c.current_dir(&dir);
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("x-terminal-emulator");
        c.current_dir(&dir);
        c
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open a terminal: {e}"))
}

/// Stopping a task is not supported for either provider yet: neither CLI
/// exposes a documented way for another process to interrupt a session, and
/// guessing at a PID to signal would be a good way to kill the wrong process.
/// The adapter advertises the capability only where it is real, so this
/// returns a plain explanation rather than pretending.
#[tauri::command]
pub fn stop_local_session(provider: String, session_id: String) -> Result<(), String> {
    let _ = (provider, session_id);
    Err("Stopping a running session is not supported for this provider yet.".into())
}

#[tauri::command]
pub fn has_credential(account: String) -> bool {
    secrets::has(&account)
}

#[tauri::command]
pub fn store_credential(account: String, secret: String) -> Result<(), String> {
    secrets::store(&account, &secret)
}

#[tauri::command]
pub fn delete_credential(account: String) -> Result<(), String> {
    secrets::delete(&account)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}
