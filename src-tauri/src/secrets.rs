use keyring::Entry;

/// Credential storage.
///
/// Credentials go to the OS keychain — Keychain on macOS, Credential Manager
/// on Windows, the Secret Service on Linux — and never to SQLite, a config
/// file, a log line, or the UI. Nothing here returns a secret to the webview:
/// the only question the UI is allowed to ask is whether one exists.
const SERVICE: &str = "dev.aicontrolcenter.app";

pub fn store(account: &str, secret: &str) -> Result<(), String> {
    Entry::new(SERVICE, account)
        .and_then(|entry| entry.set_password(secret))
        .map_err(|e| e.to_string())
}

/// Whether a credential exists. Returns a boolean, never the value, so a
/// compromised webview cannot read a secret out of the keychain through us.
pub fn has(account: &str) -> bool {
    Entry::new(SERVICE, account)
        .and_then(|entry| entry.get_password())
        .is_ok()
}

pub fn delete(account: &str) -> Result<(), String> {
    match Entry::new(SERVICE, account).and_then(|entry| entry.delete_credential()) {
        Ok(()) => Ok(()),
        // Deleting what is not there is the state the caller wanted.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Read a credential for a provider adapter's own use, inside Rust.
/// Intentionally not exposed as a Tauri command.
#[allow(dead_code)]
pub fn read(account: &str) -> Option<String> {
    Entry::new(SERVICE, account)
        .and_then(|entry| entry.get_password())
        .ok()
}
