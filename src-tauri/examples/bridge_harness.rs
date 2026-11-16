//! Runs the browser bridge on its own, approving every pairing request, and
//! prints each browser site's state as JSON whenever it changes. Used to test
//! the extension end to end: `cargo run --example bridge_harness`.
use std::sync::{mpsc, Arc};
use std::time::Duration;

use ai_control_center_lib::bridge::{self, Bridge, Effect, SITES};

fn main() {
    let bridge = Arc::new(Bridge::new());
    let (tx, rx) = mpsc::channel();
    bridge::serve(bridge.clone(), move |effect| {
        let _ = tx.send(effect);
    });
    std::thread::sleep(Duration::from_millis(200));
    println!("{}", serde_json::json!({ "ready": bridge.port() }));
    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Effect::PairRequested) => {
                for request in bridge.status().pending {
                    bridge.respond(&request.id, true).unwrap();
                    println!("{}", serde_json::json!({ "approved": request.browser }));
                }
            }
            Ok(Effect::Changed) => {
                for site in SITES {
                    let state = bridge.provider_state(site, 80);
                    if state.available {
                        println!("{}", serde_json::json!({ "site": site, "state": state }));
                    }
                }
            }
            _ => {}
        }
    }
}
