use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

use crate::state::AppState;
use crate::window;

/// Edge activation.
///
/// There is no cross-platform OS event for "the cursor reached the screen
/// edge", so this samples the pointer. The cost is kept near zero by sampling
/// slowly while the cursor is nowhere near the edge and only tightening up
/// when it gets close — the pointer has to cross most of the screen to reach
/// the edge, so a far-away cursor needs no precision at all.
///
/// The thread parks entirely when activation is switched off, so the feature
/// costs literally nothing when unused.
const IDLE_POLL_MS: u64 = 260;
const NEAR_POLL_MS: u64 = 40;
/// Within this many px of the edge we sample at the fast rate.
const NEAR_BAND_PX: f64 = 120.0;
/// After dismissing, ignore the edge until the cursor leaves this band, so the
/// panel cannot flicker back the instant it closes.
const REARM_PX: f64 = 160.0;

pub struct EdgeWatcher {
    enabled: Arc<AtomicBool>,
    sensitivity: Arc<AtomicI64>,
    dwell_ms: Arc<AtomicU64>,
}

impl EdgeWatcher {
    pub fn start(app: AppHandle, state: Arc<AppState>) -> Self {
        let enabled = Arc::new(AtomicBool::new(true));
        let sensitivity = Arc::new(AtomicI64::new(3));
        let dwell_ms = Arc::new(AtomicU64::new(120));

        let watcher = Self {
            enabled: enabled.clone(),
            sensitivity: sensitivity.clone(),
            dwell_ms: dwell_ms.clone(),
        };

        thread::spawn(move || {
            let mut dwelling_since: Option<std::time::Instant> = None;
            let mut armed = true;

            loop {
                if !enabled.load(Ordering::Relaxed) {
                    dwelling_since = None;
                    thread::sleep(Duration::from_millis(400));
                    continue;
                }

                let Ok(cursor) = app.cursor_position() else {
                    thread::sleep(Duration::from_millis(IDLE_POLL_MS));
                    continue;
                };

                let monitor = app
                    .monitor_from_point(cursor.x, cursor.y)
                    .ok()
                    .flatten();
                let Some(monitor) = monitor else {
                    thread::sleep(Duration::from_millis(IDLE_POLL_MS));
                    continue;
                };

                let origin = monitor.position();
                let size = monitor.size();
                let (edge, width) = state.edge_and_width();

                let distance = if edge == "left" {
                    cursor.x - origin.x as f64
                } else {
                    (origin.x as f64 + size.width as f64) - cursor.x
                };

                // Re-arm only once the cursor has clearly left the edge.
                if !armed {
                    if distance > REARM_PX {
                        armed = true;
                    }
                    thread::sleep(Duration::from_millis(IDLE_POLL_MS));
                    continue;
                }

                let threshold = sensitivity.load(Ordering::Relaxed) as f64;

                if distance <= threshold {
                    let dwell = Duration::from_millis(dwell_ms.load(Ordering::Relaxed));
                    match dwelling_since {
                        Some(since) if since.elapsed() >= dwell => {
                            if !window::is_visible(&app) {
                                let app2 = app.clone();
                                let edge = edge.clone();
                                // Window calls must run on the main thread.
                                let _ = app.run_on_main_thread(move || {
                                    let _ = window::show(&app2, &edge, width);
                                });
                            }
                            dwelling_since = None;
                            armed = false;
                        }
                        Some(_) => {}
                        None => dwelling_since = Some(std::time::Instant::now()),
                    }
                    thread::sleep(Duration::from_millis(NEAR_POLL_MS));
                    continue;
                }

                dwelling_since = None;
                let sleep = if distance < NEAR_BAND_PX {
                    NEAR_POLL_MS
                } else {
                    IDLE_POLL_MS
                };
                thread::sleep(Duration::from_millis(sleep));
            }
        });

        watcher
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn configure(&self, sensitivity: i64, dwell_ms: u64) {
        self.sensitivity
            .store(sensitivity.clamp(1, 24), Ordering::Relaxed);
        self.dwell_ms.store(dwell_ms.min(2_000), Ordering::Relaxed);
    }
}
