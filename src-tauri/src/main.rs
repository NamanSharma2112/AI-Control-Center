// Keep the console window from appearing alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // An agent calling us as its hook: record the event and exit, without
    // ever starting the window.
    if ai_control_center_lib::handle_hook_invocation() {
        return;
    }
    ai_control_center_lib::run()
}
