use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::providers;
use crate::window;

/// While the panel is hidden, changes are passed on at most this often: often
/// enough to notice an agent finished or needs you, rare enough to cost nothing.
const HIDDEN_INTERVAL: Duration = Duration::from_secs(30);

/// Watches the CLIs' state directories and tells the webview when something
/// changed, so the panel is event-driven rather than polled.
///
/// Debounced at 800ms because an agent writing a transcript produces a burst
/// of writes per turn. While hidden, a change that arrives inside the interval
/// is held rather than dropped and delivered when the interval ends, so the
/// last write of a session (the one that says it finished) is never lost.
pub fn start(app: AppHandle) {
    let roots = providers::watch_roots();
    if roots.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        let handle = Arc::new(app);
        let emitter = handle.clone();
        let last_hidden = Arc::new(Mutex::new(None::<Instant>));
        let held = Arc::new(AtomicBool::new(false));
        let (last_cb, held_cb) = (last_hidden.clone(), held.clone());

        let on_change = move |result: notify_debouncer_mini::DebounceEventResult| {
            if result.is_err() {
                return;
            }
            if !window::is_visible(&emitter) {
                let mut last = last_cb.lock().unwrap();
                if last.is_some_and(|t| t.elapsed() < HIDDEN_INTERVAL) {
                    held_cb.store(true, Ordering::Relaxed);
                    return;
                }
                *last = Some(Instant::now());
            }
            held_cb.store(false, Ordering::Relaxed);
            let _ = emitter.emit("provider://changed", ());
        };

        let Ok(mut debouncer) = new_debouncer(Duration::from_millis(800), on_change) else {
            return;
        };

        for root in &roots {
            let _ = debouncer.watcher().watch(root, RecursiveMode::Recursive);
        }

        // This thread owns the debouncer for the life of the app (it stops
        // watching when dropped), and delivers any held change once its
        // interval has passed.
        loop {
            std::thread::sleep(HIDDEN_INTERVAL);
            if held.swap(false, Ordering::Relaxed) {
                *last_hidden.lock().unwrap() = Some(Instant::now());
                let _ = handle.emit("provider://changed", ());
            }
        }
    });
}
