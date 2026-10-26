//! Window placement and visibility.
//!
//! The panel is attached to a screen edge rather than floating: full monitor
//! height, flush with the side, on whichever monitor the cursor is on. That
//! last part matters on a multi-monitor desk, where a panel that always
//! appears on monitor 1 is a panel you stop reaching for.

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const PANEL: &str = "panel";

pub fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PANEL)
}

/// Height of the panel the webview draws (`PANEL_HEIGHT` in `Panel.tsx`).
pub const PANEL_HEIGHT: f64 = 640.0;

/// Transparent gap the webview leaves around the panel (its CSS `p-5`). It
/// holds the panel's shadow and keeps it off the very edge of the screen.
const MARGIN: f64 = 20.0;

/// Positions the window against `edge`, vertically centred, on the monitor
/// under the cursor.
///
/// The window is exactly the floating panel plus its margin, so a click
/// anywhere outside the panel lands on another app and dismisses it. Placement
/// uses the monitor's work area, so the Windows taskbar or the macOS Dock and
/// menu bar never cover any of it.
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
    let area = monitor.work_area();
    let area_w = area.size.width as f64 / scale;
    let area_h = area.size.height as f64 / scale;

    // Never larger than the usable screen: on a small display the panel's
    // own max-height lets its content scroll instead of overflowing.
    let win_w = (width + MARGIN * 2.0).min(area_w);
    let win_h = (PANEL_HEIGHT + MARGIN * 2.0).min(area_h);
    window.set_size(LogicalSize::new(win_w, win_h))?;

    let physical_w = (win_w * scale).round() as i32;
    let physical_h = (win_h * scale).round() as i32;
    let x = if edge == "left" {
        area.position.x
    } else {
        area.position.x + area.size.width as i32 - physical_w
    };
    let y = area.position.y + (area.size.height as i32 - physical_h) / 2;

    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// How the panel was summoned. The webview uses this to decide how the panel
/// should arrive: a slow edge gesture earns a slide, a global shortcut pressed
/// dozens of times a day does not.
#[derive(Clone, Copy)]
pub enum Summon {
    Edge,
    Shortcut,
    Tray,
}

impl Summon {
    fn as_str(self) -> &'static str {
        match self {
            Summon::Edge => "edge",
            Summon::Shortcut => "shortcut",
            Summon::Tray => "tray",
        }
    }
}

/// Shows the panel and tells the webview, so it can take a fresh reading.
pub fn show(app: &AppHandle, edge: &str, width: f64, source: Summon) -> tauri::Result<()> {
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
    let _ = app.emit("panel://shown", source.as_str());
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

pub fn toggle(app: &AppHandle, edge: &str, width: f64, source: Summon) -> tauri::Result<()> {
    let Some(window) = panel(app) else {
        return Ok(());
    };
    if window.is_visible().unwrap_or(false) {
        hide(app)
    } else {
        show(app, edge, width, source)
    }
}

pub fn is_visible(app: &AppHandle) -> bool {
    panel(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}
