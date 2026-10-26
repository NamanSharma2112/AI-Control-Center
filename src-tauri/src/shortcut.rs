use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::state::AppState;
use crate::window;

/// The currently bound accelerator, so rebinding can unregister the old one.
/// Without this, changing the shortcut would leave the previous combination
/// registered and the app would answer to both.
pub struct BoundShortcut(pub Mutex<Option<Shortcut>>);

pub fn rebind(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let parsed: Shortcut = accelerator
        .parse()
        .map_err(|_| format!("\"{accelerator}\" is not a valid shortcut."))?;

    let bound = app.state::<BoundShortcut>();
    let mut current = bound.0.lock().unwrap();

    if let Some(previous) = current.take() {
        let _ = app.global_shortcut().unregister(previous);
    }

    app.global_shortcut()
        .on_shortcut(parsed, move |app, _shortcut, event| {
            // Fire on press only; without this the panel toggles twice per tap.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let state = app.state::<Arc<AppState>>();
            let (edge, width) = state.edge_and_width();
            let _ = window::toggle(app, &edge, width, window::Summon::Shortcut);
        })
        .map_err(|e| format!("Could not register {accelerator}: {e}"))?;

    *current = Some(parsed);
    Ok(())
}
