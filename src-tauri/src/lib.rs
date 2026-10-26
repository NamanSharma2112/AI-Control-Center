mod commands;
mod db;
mod edge;
mod providers;
mod secrets;
mod shortcut;
mod state;
mod tray;
mod watcher;
mod window;

use std::sync::{Arc, Mutex};
use tauri::{Manager, WindowEvent};

use db::Db;
use edge::EdgeWatcher;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::read_provider_state,
            commands::save_settings,
            commands::load_settings,
            commands::apply_window_layout,
            commands::hide_panel,
            commands::show_panel,
            commands::set_edge_watch,
            commands::set_edge_config,
            commands::set_shortcut,
            commands::set_retention,
            commands::clear_local_data,
            commands::notify,
            commands::open_path,
            commands::open_terminal,
            commands::stop_local_session,
            commands::has_credential,
            commands::store_credential,
            commands::delete_credential,
            commands::set_autostart,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let data_dir = app.path().app_data_dir()?;
            let db = Db::open(&data_dir)?;
            let state = Arc::new(AppState::new(db));

            // Honor the stored retention window at boot, so a user who asked
            // for 7 days does not find 90 waiting after an upgrade.
            let _ = state
                .db
                .prune(state.retention_days(), providers::now_ms());

            app.manage(state.clone());
            app.manage(shortcut::BoundShortcut(Mutex::new(None)));

            let edge_watcher = Arc::new(EdgeWatcher::start(handle.clone(), state.clone()));
            app.manage(commands::Watcher(edge_watcher));

            tray::build(&handle)?;
            watcher::start(handle.clone());

            // A default binding exists from first launch; the webview replaces
            // it with the user's own once preferences load.
            let _ = shortcut::rebind(&handle, "CommandOrControl+Shift+Space");

            // No dock icon on macOS: this is a menu-bar utility, and a bouncing
            // dock icon would contradict "invisible until summoned".
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Click-away dismissal. The window is never destroyed — the app
            // keeps running in the tray, which is the whole point.
            WindowEvent::Focused(false) => {
                let _ = window::hide(window.app_handle());
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window::hide(window.app_handle());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Control Center");
}
