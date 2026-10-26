use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::window;

/// System tray / menu bar presence.
///
/// This is the app's only permanent UI: there is no dock icon and no main
/// window, so the tray is what proves it is running and how it is quit.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open panel", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AI Control Center", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &separator, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .tooltip("AI Control Center")
        .menu(&menu)
        // The menu is for the right-click; a left-click should just open.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let state = app.state::<Arc<AppState>>();
            let (edge, width) = state.edge_and_width();
            match event.id().as_ref() {
                "open" => {
                    let _ = window::show(app, &edge, width, window::Summon::Tray);
                }
                "settings" => {
                    let _ = window::show(app, &edge, width, window::Summon::Tray);
                    let _ = tauri::Emitter::emit(app, "panel://settings", ());
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let state = app.state::<Arc<AppState>>();
                let (edge, width) = state.edge_and_width();
                let _ = window::toggle(app, &edge, width, window::Summon::Tray);
            }
        })
        .build(app)?;

    Ok(())
}
