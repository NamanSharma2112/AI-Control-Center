//! The island: a small pill at the top centre of the screen that says, in one
//! line, the most important thing your agents are doing, and opens into the
//! full detail when you hover it — like the iPhone's Dynamic Island.
//!
//! Hover is tracked here, from the cursor position, rather than by the web
//! page: macOS does not reliably deliver hover to a window of an app that is
//! not active, and the island must react without being clicked first.
//!
//! It is either always on screen or, in hover mode, hidden until the cursor
//! reaches the top centre of the screen.
//!
//! The window is only ever as big as what it shows. Collapsed, it is the size
//! of the pill, so the island never blocks clicks on the windows beneath it;
//! it grows just before the card opens and shrinks just after it closes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const ISLAND: &str = "island";

/// Logical sizes of the window, including room for the pill's shadow.
const COLLAPSED: (f64, f64) = (380.0, 64.0);
const EXPANDED: (f64, f64) = (480.0, 420.0);
/// Gap between the top of the usable screen and the island.
const TOP_GAP: f64 = 6.0;
/// How long the card stays after the cursor leaves, so a pass over its
/// edge does not snap it shut.
const LEAVE_GRACE: Duration = Duration::from_millis(220);
/// Time the card's closing animation takes before the window shrinks.
const CLOSE_ANIMATION: Duration = Duration::from_millis(300);
/// Time the pill takes to fade before a hover-only island hides.
const FADE_OUT: Duration = Duration::from_millis(160);
/// How far below the top of the usable screen (logical px) the cursor calls
/// up a hidden island.
const REVEAL_DEPTH: f64 = 6.0;
/// How far below the top (logical px) the cursor counts as near the island.
const NEAR_DEPTH: f64 = 200.0;

pub struct IslandState {
    enabled: AtomicBool,
    /// Hidden until the cursor reaches the top centre of the screen, rather
    /// than always on screen.
    hover_only: AtomicBool,
}

impl IslandState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            hover_only: AtomicBool::new(false),
        }
    }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ISLAND)
}

/// Sizes the window and centres it at the top of the primary monitor's
/// usable area (below the macOS menu bar; above everything on Windows).
fn place(app: &AppHandle, expanded: bool) -> tauri::Result<()> {
    let Some(win) = window(app) else {
        return Ok(());
    };
    let Some(monitor) = app.primary_monitor()?.or(win.current_monitor()?) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (w, h) = if expanded { EXPANDED } else { COLLAPSED };
    win.set_size(LogicalSize::new(w, h))?;
    let physical_w = (w * scale).round() as i32;
    let x = area.position.x + (area.size.width as i32 - physical_w) / 2;
    let y = area.position.y + (TOP_GAP * scale).round() as i32;
    win.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// How the island is shown, from the setting: "always" on screen, only on
/// "hover" at the top centre of the screen, or "off".
pub fn set_mode(app: &AppHandle, mode: &str) -> tauri::Result<()> {
    let (enabled, hover_only) = match mode {
        "off" => (false, false),
        "hover" => (true, true),
        _ => (true, false),
    };
    let state = app.state::<Arc<IslandState>>();
    state.enabled.store(enabled, Ordering::Relaxed);
    state.hover_only.store(hover_only, Ordering::Relaxed);
    let Some(win) = window(app) else {
        return Ok(());
    };
    if enabled && !hover_only {
        place(app, false)?;
        win.show()?;
        win.set_always_on_top(true)?;
    } else {
        win.hide()?;
    }
    Ok(())
}

pub fn is_visible(app: &AppHandle) -> bool {
    window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// The primary monitor's geometry, in physical pixels.
#[derive(Clone, Copy)]
struct Screen {
    top: f64,
    area_top: f64,
    centre_x: f64,
    scale: f64,
}

fn screen(app: &AppHandle) -> Option<Screen> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let area = monitor.work_area();
    Some(Screen {
        top: monitor.position().y as f64,
        area_top: area.position.y as f64,
        centre_x: area.position.x as f64 + area.size.width as f64 / 2.0,
        scale: monitor.scale_factor(),
    })
}

/// Whether the cursor is at the very top of the screen, around its centre:
/// where a hidden island is called up from. On macOS this includes the menu
/// bar above the island.
fn in_reveal_zone(cursor: (f64, f64), s: &Screen) -> bool {
    let half_width = COLLAPSED.0 / 2.0 * s.scale;
    cursor.1 >= s.top
        && cursor.1 <= s.area_top + REVEAL_DEPTH * s.scale
        && (cursor.0 - s.centre_x).abs() <= half_width
}

/// Follows the cursor: opens the card when it enters the island, closes it a
/// moment after it leaves. In hover mode it also brings the hidden island
/// out at the top of the screen and puts it away again afterwards. Samples
/// slowly unless the cursor is near the top of the screen.
pub fn start_hover_watch(app: AppHandle, state: Arc<IslandState>) {
    thread::spawn(move || {
        let mut expanded = false;
        let mut left_at: Option<Instant> = None;
        let mut geometry: Option<(Screen, Instant)> = None;

        loop {
            if !state.enabled.load(Ordering::Relaxed) {
                expanded = false;
                left_at = None;
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let hover_only = state.hover_only.load(Ordering::Relaxed);

            // Monitors rarely change; look them up every couple of seconds.
            if geometry.is_none_or(|(_, at)| at.elapsed() > Duration::from_secs(2)) {
                geometry = screen(&app).map(|s| (s, Instant::now()));
            }
            let (Some(win), Ok(cursor), Some((scr, _))) =
                (window(&app), app.cursor_position(), geometry)
            else {
                thread::sleep(Duration::from_millis(400));
                continue;
            };
            let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
                thread::sleep(Duration::from_millis(400));
                continue;
            };
            let visible = win.is_visible().unwrap_or(false);

            let (left, top) = (pos.x as f64, pos.y as f64);
            let (right, bottom) = (left + size.width as f64, top + size.height as f64);
            // The strip between the top of the screen and the island counts
            // as the island, so reaching up for it never closes it.
            let inside = visible
                && cursor.x >= left
                && cursor.x <= right
                && cursor.y >= scr.top.min(top)
                && cursor.y <= bottom;

            if hover_only && !visible && !expanded {
                if in_reveal_zone((cursor.x, cursor.y), &scr) {
                    expanded = true;
                    left_at = None;
                    let a = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let _ = place(&a, true);
                        if let Some(w) = window(&a) {
                            let _ = w.show();
                            let _ = w.set_always_on_top(true);
                        }
                        let _ = a.emit_to(ISLAND, "island://hover", true);
                    });
                }
            } else if inside {
                left_at = None;
                if !expanded {
                    expanded = true;
                    let a = app.clone();
                    // Grow the window first, then let the card morph into it.
                    let _ = app.run_on_main_thread(move || {
                        let _ = place(&a, true);
                        let _ = a.emit_to(ISLAND, "island://hover", true);
                    });
                }
            } else if expanded {
                match left_at {
                    None => left_at = Some(Instant::now()),
                    Some(t) if t.elapsed() >= LEAVE_GRACE => {
                        let _ = app.emit_to(ISLAND, "island://hover", false);
                        thread::sleep(CLOSE_ANIMATION);
                        if hover_only {
                            // Let the pill fade before the window goes.
                            let _ = app.emit_to(ISLAND, "island://hide", ());
                            thread::sleep(FADE_OUT);
                        }
                        expanded = false;
                        left_at = None;
                        let a = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            if hover_only {
                                if let Some(w) = window(&a) {
                                    let _ = w.hide();
                                }
                            }
                            let _ = place(&a, false);
                        });
                    }
                    Some(_) => {}
                }
            }

            // Near the top of the screen, sample fast enough to feel instant;
            // anywhere else, barely at all.
            let near = cursor.y <= scr.area_top + NEAR_DEPTH * scr.scale;
            thread::sleep(Duration::from_millis(if near || expanded {
                40
            } else {
                300
            }));
        }
    });
}

#[tauri::command]
pub fn set_island_mode(app: AppHandle, mode: String) -> Result<(), String> {
    set_mode(&app, &mode).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Screen = Screen {
        top: 0.0,
        area_top: 50.0, // a macOS menu bar, in physical pixels at 2x
        centre_x: 1440.0,
        scale: 2.0,
    };

    #[test]
    fn reveal_zone_is_the_top_centre_only() {
        assert!(in_reveal_zone((1440.0, 0.0), &SCREEN));
        assert!(in_reveal_zone((1440.0, 50.0), &SCREEN));
        assert!(in_reveal_zone((1440.0 + 370.0, 10.0), &SCREEN));
        // Off to the side: the menu bar's own menus and icons.
        assert!(!in_reveal_zone((1440.0 + 400.0, 10.0), &SCREEN));
        assert!(!in_reveal_zone((200.0, 0.0), &SCREEN));
        // Below the strip: ordinary work at the top of a window.
        assert!(!in_reveal_zone((1440.0, 120.0), &SCREEN));
    }
}
