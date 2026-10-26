use std::sync::Mutex;

use crate::db::Db;

/// Shared state the Rust side keeps between calls.
///
/// Deliberately tiny: the webview owns the view model, and Rust owns only what
/// the OS integration genuinely needs to know before the webview has spoken —
/// where to put the window, and how to watch the edge.
pub struct AppState {
    pub db: Db,
    layout: Mutex<Layout>,
}

#[derive(Clone)]
struct Layout {
    edge: String,
    width: f64,
    retention_days: i64,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            layout: Mutex::new(Layout {
                edge: "right".to_string(),
                width: 380.0,
                retention_days: 30,
            }),
        }
    }

    pub fn edge_and_width(&self) -> (String, f64) {
        let layout = self.layout.lock().unwrap();
        (layout.edge.clone(), layout.width)
    }

    pub fn set_layout(&self, edge: &str, width: f64) {
        let mut layout = self.layout.lock().unwrap();
        layout.edge = if edge == "left" { "left" } else { "right" }.to_string();
        layout.width = width.clamp(300.0, 600.0);
    }

    pub fn retention_days(&self) -> i64 {
        self.layout.lock().unwrap().retention_days
    }

    pub fn set_retention_days(&self, days: i64) {
        self.layout.lock().unwrap().retention_days = days.max(0);
    }

    /// The caps the user set, read back out of the stored settings blob so the
    /// provider readers express usage against the user's own ceiling.
    pub fn cap_for(&self, provider: &str) -> i64 {
        let fallback = if provider == "codex" {
            1_500
        } else {
            2_000_000
        };
        let Ok(Some(json)) = self.db.load_settings() else {
            return fallback;
        };
        serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("caps")?.get(provider)?.as_i64())
            .unwrap_or(fallback)
    }
}
