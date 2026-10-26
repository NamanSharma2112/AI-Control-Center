use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::providers;
use crate::window;

/// Watches the CLIs' state directories and tells the webview when something
/// changed, so the panel is event-driven rather than polled.
///
/// Debounced at 800ms because an agent writing a transcript produces a burst
/// of writes per turn, and re-reading on each one would be the polling we are
/// avoiding. Events are dropped entirely while the panel is hidden: nothing
/// is on screen to update, and the next open takes a fresh reading anyway.
pub fn start(app: AppHandle) {
    let roots = providers::watch_roots();
    if roots.is_empty() {
        return;
    }

    std::thread::spawn(move || {
        let handle = Arc::new(app);
        let emitter = handle.clone();

        let on_change = move |result: notify_debouncer_mini::DebounceEventResult| {
            if result.is_err() {
                return;
            }
            if !window::is_visible(&emitter) {
                return;
            }
            let _ = emitter.emit("provider://changed", ());
        };

        let Ok(mut debouncer) = new_debouncer(Duration::from_millis(800), on_change) else {
            return;
        };

        for root in &roots {
            let _ = debouncer.watcher().watch(root, RecursiveMode::Recursive);
        }

        // The debouncer stops watching when dropped, so this thread owns it
        // for the life of the app.
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}
