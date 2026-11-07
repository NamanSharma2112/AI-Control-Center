//! The island: a small pill at the top centre of the screen that says, in one
//! line, the most important thing your agents are doing, and opens into the
//! full detail when you hover it — like the iPhone's Dynamic Island.
//!
//! Hover is tracked here, from the cursor position, rather than by the web
//! page: macOS does not reliably deliver hover to a window of an app that is
//! not active, and the island must react without being clicked first.
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

pub struct IslandState {
    enabled: AtomicBool,
}

impl IslandState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
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

/// Shows or hides the island, from the setting.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    let state = app.state::<Arc<IslandState>>();
    state.enabled.store(enabled, Ordering::Relaxed);
    let Some(win) = window(app) else {
        return Ok(());
    };
    if enabled {
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

/// Follows the cursor: opens the card when it enters the island, closes it a
/// moment after it leaves. Samples slowly unless the cursor is near the top
/// of the screen, where the island is.
pub fn start_hover_watch(app: AppHandle, state: Arc<IslandState>) {
    thread::spawn(move || {
        let mut expanded = false;
        let mut left_at: Option<Instant> = None;

        loop {
            if !state.enabled.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let (Some(win), Ok(cursor)) = (window(&app), app.cursor_position()) else {
                thread::sleep(Duration::from_millis(400));
                continue;
            };
            let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
                thread::sleep(Duration::from_millis(400));
                continue;
            };

            let (left, top) = (pos.x as f64, pos.y as f64);
            let (right, bottom) = (left + size.width as f64, top + size.height as f64);
            let inside =
                cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;

            if inside {
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
                        expanded = false;
                        left_at = None;
                        let a = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            let _ = place(&a, false);
                        });
                    }
                    Some(_) => {}
                }
            }

            // Near the top of the screen, sample fast enough to feel instant;
            // anywhere else, barely at all.
            let near = cursor.y <= bottom + 160.0;
            thread::sleep(Duration::from_millis(if near || expanded {
                40
            } else {
                300
            }));
        }
    });
}

#[tauri::command]
pub fn set_island_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_enabled(&app, enabled).map_err(|e| e.to_string())
}
