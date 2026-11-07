//! The agents' own notification hooks.
//!
//! Claude Code can run a command the moment it needs the user (a permission
//! prompt) and when it finishes a turn; Codex can run one when it finishes a
//! turn. Both call this app's own executable with `--hook <provider>`. In that
//! mode the app does not start its window: it appends one line to an events
//! file and exits. The running app watches that file, so "Needs you" and
//! "Finished" are exact and instant instead of inferred from silence.
//!
//! Installing edits the user's agent configuration, so it happens only on an
//! explicit click, keeps a one-time backup, touches only entries this app
//! added, and can be undone from the same place.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::providers::now_ms;

/// Must match the Tauri identifier, so this is the app's own data folder.
const APP_ID: &str = "dev.aicontrolcenter.app";
const EVENTS_FILE: &str = "hook-events.jsonl";
/// The events file is trimmed to its newest lines once it grows past this.
const EVENTS_MAX_BYTES: u64 = 512 * 1024;
const EVENTS_KEEP_LINES: usize = 400;

/// One hook firing, as written to the events file.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HookEvent {
    pub provider: String,
    /// "needs-you" or "finished".
    pub kind: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub message: Option<String>,
    pub ts: i64,
}

pub fn events_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(APP_ID).join(EVENTS_FILE))
}

/* --------------------------------------------------------------------------
Hook mode: called by the agents, never by the user
-------------------------------------------------------------------------- */

/// Entry point for `<app> --hook <provider> [payload]`. Always exits quietly:
/// a hook that fails must never interrupt the agent that called it.
pub fn run_hook(args: &[String]) {
    let Some(pos) = args.iter().position(|a| a == "--hook") else {
        return;
    };
    let provider = args.get(pos + 1).cloned().unwrap_or_default();

    // Claude Code sends JSON on stdin; Codex passes it as the last argument.
    let payload = match provider.as_str() {
        "codex" => args.last().cloned().unwrap_or_default(),
        _ => {
            let mut buf = String::new();
            let _ = std::io::stdin().take(1024 * 1024).read_to_string(&mut buf);
            buf
        }
    };

    if let Some(event) = parse_hook(&provider, &payload, now_ms()) {
        let _ = append_event(&event);
    }
}

/// Turns a hook payload into an event, or None for hooks we do not act on.
pub fn parse_hook(provider: &str, payload: &str, now: i64) -> Option<HookEvent> {
    let v: Value = serde_json::from_str(payload.trim()).ok()?;
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    match provider {
        "claude-code" => {
            let kind = match v.get("hook_event_name")?.as_str()? {
                "Notification" => "needs-you",
                "Stop" => "finished",
                _ => return None,
            };
            Some(HookEvent {
                provider: provider.into(),
                kind: kind.into(),
                session_id: text("session_id"),
                cwd: text("cwd"),
                message: text("message"),
                ts: now,
            })
        }
        "codex" => {
            if v.get("type")?.as_str()? != "agent-turn-complete" {
                return None;
            }
            Some(HookEvent {
                provider: provider.into(),
                kind: "finished".into(),
                session_id: text("thread-id").or_else(|| text("thread_id")),
                cwd: text("cwd"),
                message: None,
                ts: now,
            })
        }
        _ => None,
    }
}

fn append_event(event: &HookEvent) -> std::io::Result<()> {
    let path = events_path().ok_or_else(|| std::io::Error::other("no data dir"))?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if fs::metadata(&path).is_ok_and(|m| m.len() > EVENTS_MAX_BYTES) {
        let text = fs::read_to_string(&path).unwrap_or_default();
        let lines: Vec<&str> = text.lines().collect();
        let keep = lines[lines.len().saturating_sub(EVENTS_KEEP_LINES)..].join("\n");
        fs::write(&path, keep + "\n")?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(file, "{}", serde_json::to_string(event)?)
}

/// The newest events, oldest first. Reads only the file's tail.
pub fn read_events() -> Vec<HookEvent> {
    let Some(path) = events_path() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    text.lines()
        .rev()
        .take(EVENTS_KEEP_LINES)
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

/* --------------------------------------------------------------------------
Install / uninstall
-------------------------------------------------------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    /// Whether the agent's config folder exists at all on this machine.
    pub agent_found: bool,
    pub installed: bool,
    /// Installed, but pointing at a different copy of the app (moved or
    /// reinstalled); reconnecting fixes it.
    pub stale: bool,
    /// Why it cannot be installed, if it cannot.
    pub problem: Option<String>,
}

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Could not find this app's location: {e}"))
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Could not find your home folder.".to_string())
}

fn backup_once(path: &Path) {
    let backup = path.with_extension(format!(
        "{}.acc-backup",
        path.extension().and_then(|e| e.to_str()).unwrap_or("bak")
    ));
    if path.exists() && !backup.exists() {
        let _ = fs::copy(path, backup);
    }
}

/// The command line an agent should run. Quoted so a path with spaces
/// ("AI Control Center.exe") survives the agent's shell.
fn claude_command(exe: &str) -> String {
    format!("\"{exe}\" --hook claude-code")
}

fn is_ours(command: &str) -> bool {
    command.contains("--hook claude-code")
}

/* ---------- Claude Code: ~/.claude/settings.json ---------- */

fn claude_settings() -> Result<PathBuf, String> {
    Ok(home()?.join(".claude").join("settings.json"))
}

/// Adds our hook to `Notification` and `Stop`, replacing any older copy of
/// ours and leaving every other hook exactly as it was.
pub fn claude_install_into(settings: &mut Value, exe: &str) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Claude Code's settings.json is not a JSON object.".into());
    }
    claude_remove_from(settings);
    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or("The \"hooks\" entry in Claude Code's settings is not an object.")?;
    for event in ["Notification", "Stop"] {
        let list = hooks.entry(event).or_insert_with(|| json!([]));
        let list = list
            .as_array_mut()
            .ok_or(format!("Claude Code's \"{event}\" hooks are not a list."))?;
        list.push(json!({
            "hooks": [{ "type": "command", "command": claude_command(exe) }]
        }));
    }
    Ok(())
}

/// Removes only our entries; drops groups and lists we leave empty.
pub fn claude_remove_from(settings: &mut Value) {
    let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return;
    };
    for event in ["Notification", "Stop"] {
        let Some(list) = hooks.get_mut(event).and_then(|l| l.as_array_mut()) else {
            continue;
        };
        for group in list.iter_mut() {
            if let Some(inner) = group.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                inner.retain(|h| {
                    !h.get("command")
                        .and_then(|c| c.as_str())
                        .is_some_and(is_ours)
                });
            }
        }
        list.retain(|g| {
            g.get("hooks")
                .and_then(|h| h.as_array())
                .is_none_or(|h| !h.is_empty())
        });
        if list.is_empty() {
            hooks.remove(event);
        }
    }
    if hooks.is_empty() {
        settings.as_object_mut().unwrap().remove("hooks");
    }
}

fn claude_status() -> HookStatus {
    let (Ok(path), Ok(exe)) = (claude_settings(), exe_path()) else {
        return HookStatus {
            agent_found: false,
            installed: false,
            stale: false,
            problem: None,
        };
    };
    let agent_found = path.parent().is_some_and(Path::exists);
    let text = fs::read_to_string(&path).unwrap_or_default();
    let commands: Vec<String> = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("hooks").cloned())
        .map(|h| {
            let mut out = Vec::new();
            collect_commands(&h, &mut out);
            out
        })
        .unwrap_or_default();
    let ours: Vec<&String> = commands.iter().filter(|c| is_ours(c)).collect();
    HookStatus {
        agent_found,
        installed: !ours.is_empty(),
        stale: !ours.is_empty() && ours.iter().any(|c| **c != claude_command(&exe)),
        problem: None,
    }
}

fn collect_commands(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            if let Some(c) = m.get("command").and_then(|c| c.as_str()) {
                out.push(c.to_string());
            }
            m.values().for_each(|x| collect_commands(x, out));
        }
        Value::Array(a) => a.iter().for_each(|x| collect_commands(x, out)),
        _ => {}
    }
}

/* ---------- Codex: ~/.codex/config.toml ---------- */

fn codex_config() -> Result<PathBuf, String> {
    Ok(home()?.join(".codex").join("config.toml"))
}

fn codex_notify(exe: &str) -> toml_edit::Array {
    let mut a = toml_edit::Array::new();
    a.push(exe);
    a.push("--hook");
    a.push("codex");
    a
}

fn notify_is_ours(doc: &toml_edit::DocumentMut) -> Option<bool> {
    let arr = doc.get("notify")?.as_array()?;
    let items: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
    Some(items.len() == 3 && items[1] == "--hook" && items[2] == "codex")
}

/// Sets `notify` to call this app. Refuses to replace a notify command the
/// user set up themselves: Codex allows only one.
pub fn codex_install_into(doc: &mut toml_edit::DocumentMut, exe: &str) -> Result<(), String> {
    if notify_is_ours(doc) == Some(false) {
        return Err(
            "Codex already runs another notify command, and it allows only one. \
             Remove it from ~/.codex/config.toml first if you want to use this."
                .into(),
        );
    }
    doc["notify"] = toml_edit::value(codex_notify(exe));
    Ok(())
}

pub fn codex_remove_from(doc: &mut toml_edit::DocumentMut) {
    if notify_is_ours(doc) == Some(true) {
        doc.remove("notify");
    }
}

fn codex_status() -> HookStatus {
    let (Ok(path), Ok(exe)) = (codex_config(), exe_path()) else {
        return HookStatus {
            agent_found: false,
            installed: false,
            stale: false,
            problem: None,
        };
    };
    let agent_found = path.parent().is_some_and(Path::exists);
    let doc: toml_edit::DocumentMut = fs::read_to_string(&path)
        .unwrap_or_default()
        .parse()
        .unwrap_or_default();
    let ours = notify_is_ours(&doc);
    let installed = ours == Some(true);
    let stale = installed
        && doc
            .get("notify")
            .and_then(|n| n.as_array())
            .and_then(|a| a.get(0))
            .and_then(|v| v.as_str())
            != Some(exe.as_str());
    HookStatus {
        agent_found,
        installed,
        stale,
        problem: (ours == Some(false))
            .then(|| "Codex already runs another notify command.".to_string()),
    }
}

/* ---------- Commands ---------- */

#[tauri::command]
pub fn hook_status(provider: String) -> HookStatus {
    match provider.as_str() {
        "claude-code" => claude_status(),
        "codex" => codex_status(),
        _ => HookStatus {
            agent_found: false,
            installed: false,
            stale: false,
            problem: None,
        },
    }
}

#[tauri::command]
pub fn install_hooks(provider: String) -> Result<(), String> {
    let exe = exe_path()?;
    match provider.as_str() {
        "claude-code" => {
            let path = claude_settings()?;
            let mut settings: Value = match fs::read_to_string(&path) {
                Ok(text) if !text.trim().is_empty() => serde_json::from_str(&text)
                    .map_err(|e| format!("Claude Code's settings.json could not be read: {e}"))?,
                _ => json!({}),
            };
            claude_install_into(&mut settings, &exe)?;
            write_config(&path, &serde_json::to_string_pretty(&settings).unwrap())
        }
        "codex" => {
            let path = codex_config()?;
            let mut doc: toml_edit::DocumentMut = fs::read_to_string(&path)
                .unwrap_or_default()
                .parse()
                .map_err(|e| format!("Codex's config.toml could not be read: {e}"))?;
            codex_install_into(&mut doc, &exe)?;
            write_config(&path, &doc.to_string())
        }
        _ => Err("Unknown provider.".into()),
    }
}

#[tauri::command]
pub fn uninstall_hooks(provider: String) -> Result<(), String> {
    match provider.as_str() {
        "claude-code" => {
            let path = claude_settings()?;
            let Ok(text) = fs::read_to_string(&path) else {
                return Ok(());
            };
            let mut settings: Value =
                serde_json::from_str(&text).map_err(|e| format!("settings.json: {e}"))?;
            claude_remove_from(&mut settings);
            write_config(&path, &serde_json::to_string_pretty(&settings).unwrap())
        }
        "codex" => {
            let path = codex_config()?;
            let Ok(text) = fs::read_to_string(&path) else {
                return Ok(());
            };
            let mut doc: toml_edit::DocumentMut =
                text.parse().map_err(|e| format!("config.toml: {e}"))?;
            codex_remove_from(&mut doc);
            write_config(&path, &doc.to_string())
        }
        _ => Err("Unknown provider.".into()),
    }
}

fn write_config(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    backup_once(path);
    // Write beside, then rename: a crash mid-write never leaves the agent
    // with a half-written config.
    let tmp = path.with_extension("acc-tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/Applications/AI Control Center.app/Contents/MacOS/ai-control-center";

    #[test]
    fn parses_claude_hooks() {
        let n = parse_hook(
            "claude-code",
            r#"{"hook_event_name":"Notification","session_id":"s1","cwd":"/p","message":"Claude needs your permission to use Bash"}"#,
            5,
        )
        .unwrap();
        assert_eq!(n.kind, "needs-you");
        assert_eq!(n.session_id.as_deref(), Some("s1"));
        assert_eq!(
            n.message.as_deref(),
            Some("Claude needs your permission to use Bash")
        );

        let s = parse_hook(
            "claude-code",
            r#"{"hook_event_name":"Stop","session_id":"s1"}"#,
            5,
        )
        .unwrap();
        assert_eq!(s.kind, "finished");

        assert!(parse_hook("claude-code", r#"{"hook_event_name":"PreToolUse"}"#, 5).is_none());
        assert!(parse_hook("claude-code", "not json", 5).is_none());
    }

    #[test]
    fn parses_codex_notify() {
        let e = parse_hook(
            "codex",
            r#"{"type":"agent-turn-complete","thread-id":"t1","cwd":"/p","last-assistant-message":"done"}"#,
            9,
        )
        .unwrap();
        assert_eq!(
            (e.kind.as_str(), e.session_id.as_deref()),
            ("finished", Some("t1"))
        );
        assert!(parse_hook("codex", r#"{"type":"other"}"#, 9).is_none());
    }

    #[test]
    fn claude_install_is_idempotent_and_keeps_user_hooks() {
        let mut s = json!({
            "model": "opus",
            "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }
        });
        claude_install_into(&mut s, EXE).unwrap();
        claude_install_into(&mut s, EXE).unwrap(); // second click changes nothing

        let stop = s["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "user's hook kept, ours added once");
        assert_eq!(stop[0]["hooks"][0]["command"], "say done");
        assert_eq!(s["hooks"]["Notification"].as_array().unwrap().len(), 1);
        assert_eq!(s["model"], "opus");
        assert!(stop[1]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .starts_with('"'));

        claude_remove_from(&mut s);
        assert_eq!(
            s["hooks"]["Stop"].as_array().unwrap().len(),
            1,
            "only ours removed"
        );
        assert!(s["hooks"].get("Notification").is_none());
    }

    #[test]
    fn claude_remove_drops_empty_hooks_object() {
        let mut s = json!({});
        claude_install_into(&mut s, EXE).unwrap();
        claude_remove_from(&mut s);
        assert_eq!(s, json!({}));
    }

    #[test]
    fn codex_install_respects_existing_notify() {
        let mut doc: toml_edit::DocumentMut =
            "model = \"gpt-5-codex\"\n\n[tui]\nx = 1\n".parse().unwrap();
        codex_install_into(&mut doc, EXE).unwrap();
        let text = doc.to_string();
        // notify must be a top-level key, written before any [table].
        assert!(
            text.find("notify").unwrap() < text.find("[tui]").unwrap(),
            "{text}"
        );
        assert_eq!(notify_is_ours(&doc), Some(true));
        codex_install_into(&mut doc, EXE).unwrap(); // reconnect is fine

        codex_remove_from(&mut doc);
        assert!(doc.get("notify").is_none());
        assert!(doc.to_string().contains("model = \"gpt-5-codex\""));

        let mut theirs: toml_edit::DocumentMut =
            "notify = [\"notify-send\", \"x\"]\n".parse().unwrap();
        assert!(codex_install_into(&mut theirs, EXE).is_err());
        codex_remove_from(&mut theirs);
        assert!(
            theirs.get("notify").is_some(),
            "never removes someone else's notify"
        );
    }
}
