use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const PANEL: &str = "panel";

/// Window placement and visibility.
///
/// The panel is attached to a screen edge rather than floating: full monitor
/// height, flush with the side, on whichever monitor the cursor is on. That
/// last part matters on a multi-monitor desk, where a panel that always
/// appears on monitor 1 is a panel you stop reaching for.

pub fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PANEL)
}

/// Positions the panel against `edge` on the monitor under the cursor.
pub fn apply_layout(app: &AppHandle, edge: &str, width: f64) -> tauri::Result<()> {
    let Some(window) = panel(app) else {
        return Ok(());
    };

    let cursor = app.cursor_position().ok();
    let monitor = match cursor {
        Some(pos) => app
            .monitor_from_point(pos.x, pos.y)?
            .or(window.current_monitor()?),
        None => window.current_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();

    window.set_size(LogicalSize::new(width, size.height as f64 / scale))?;

    let physical_width = (width * scale).round() as i32;
    let x = if edge == "left" {
        origin.x
    } else {
        origin.x + size.width as i32 - physical_width
    };

    window.set_position(PhysicalPosition::new(x, origin.y))?;
    Ok(())
}

/// Shows the panel and tells the webview, so it can take a fresh reading.
pub fn show(app: &AppHandle, edge: &str, width: f64) -> tauri::Result<()> {
    let Some(window) = panel(app) else {
        return Ok(());
    };
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    apply_layout(app, edge, width)?;
    window.show()?;
    window.set_always_on_top(true)?;
    window.set_focus()?;
    let _ = app.emit("panel://shown", ());
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = panel(app) else {
        return Ok(());
    };
    if window.is_visible().unwrap_or(false) {
        window.hide()?;
    }
    Ok(())
}

pub fn toggle(app: &AppHandle, edge: &str, width: f64) -> tauri::Result<()> {
    let Some(window) = panel(app) else {
        return Ok(());
    };
    if window.is_visible().unwrap_or(false) {
        hide(app)
    } else {
        show(app, edge, width)
    }
}

pub fn is_visible(app: &AppHandle) -> bool {
    panel(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}
