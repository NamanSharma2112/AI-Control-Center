//! Reading local provider state.
//!
//! Both supported CLIs keep their own session history on disk, in the user's
//! home directory, as newline-delimited JSON. We read those files and nothing
//! else: no network calls, no browser storage, no authenticated pages. The
//! files belong to the user and are already on their machine.
//!
//! Everything here is bounded on purpose. We stat before we read, skip
//! anything older than the window, cap how many sessions we open, and read a
//! tail rather than a whole file — a chatty agent can leave a multi-megabyte
//! transcript, and the panel must open instantly regardless.

//! Never open more than this many session files in one read.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SESSION_FILES: usize = 24;
/// Ignore sessions untouched for longer than this.
const SESSION_MAX_AGE_MS: i64 = 3 * 86_400_000;
/// Bytes of each transcript's tail we inspect for the latest activity.
const TAIL_BYTES: u64 = 64 * 1024;
/// Cap on activities returned, before the UI's own limit.
const MAX_ACTIVITIES: usize = 200;

/// Steps kept per session after merging. The card shows the last five.
const MAX_STEPS: usize = 8;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalStepDto {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub started_at: i64,
    /// Time until the next step began; None for the latest step.
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionDto {
    pub id: String,
    pub project: String,
    pub project_path: String,
    pub status: String,
    pub started_at: i64,
    pub last_activity_at: i64,
    pub current_activity: String,
    pub event_count: i64,
    pub model: Option<String>,
    pub steps: Vec<LocalStepDto>,
    pub files_changed: i64,
    /// The agent's last act was finishing its turn: it is done and idle.
    pub turn_ended: bool,
    /// The agent called a tool that has not returned yet. When that lasts,
    /// the CLI is usually waiting for the user to approve the call.
    pub pending_tool: bool,
    /// The same command failing again and again: the agent is stuck.
    pub stuck: Option<StuckDto>,
    /// The latest hook event for this session, when one arrived after the
    /// transcript's last write. Exact, where the flags above are inferred.
    pub hook: Option<HookStateDto>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StuckDto {
    pub command: String,
    pub failures: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HookStateDto {
    /// "needs-you" or "finished".
    pub kind: String,
    pub message: Option<String>,
    pub at: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalActivityDto {
    pub id: String,
    pub session_id: Option<String>,
    pub project: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageDto {
    pub used: i64,
    pub cap: i64,
    /// When the current window closes; None when no window is open (nothing
    /// used since the last one ended).
    pub reset_at: Option<i64>,
    pub unit: String,
    pub window: String,
    /// Share of the limit used, when the provider itself reported it.
    pub used_percent: Option<f64>,
    /// "provider" when the figure came from the provider, else "local".
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderStateDto {
    pub available: bool,
    pub detail: Option<String>,
    pub sessions: Vec<LocalSessionDto>,
    pub activities: Vec<LocalActivityDto>,
    pub usage: Option<LocalUsageDto>,
}

impl LocalProviderStateDto {
    fn unavailable(detail: &str) -> Self {
        Self {
            available: false,
            detail: Some(detail.to_string()),
            sessions: Vec::new(),
            activities: Vec::new(),
            usage: None,
        }
    }
}

/// One record from a transcript, reduced to what we actually use. Both CLIs'
/// shapes fit: Claude Code puts fields at the top level and under `message`,
/// Codex wraps them in `payload`.
#[derive(Debug, Deserialize, Default)]
struct Record {
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default, rename = "sessionId")]
    session_id: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    ts: Option<serde_json::Value>,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    message: Option<serde_json::Value>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

/// What a record contributed to the agent's visible progress.
#[derive(Debug, Clone, PartialEq)]
struct Step {
    kind: &'static str,
    label: String,
    /// The file a read or edit touched, for merging runs and counting edits.
    file: Option<String>,
}

/// A change in what the agent is waiting on. Folded over a transcript, these
/// say whether a session is working, waiting on a tool, or finished.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Signal {
    Prompted,
    ToolCalled,
    ToolReturned,
    /// An explicit end-of-turn marker, or a plain reply with no tool call.
    TurnEnded,
}

/// A shell command being called, or its result coming back.
#[derive(Debug, Clone, PartialEq)]
enum ToolEvent {
    Call { id: String, command: String },
    Result { id: String, failed: bool },
}

/// One rate-limit window as the provider reported it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RateWindow {
    used_percent: f64,
    /// Epoch ms.
    resets_at: Option<i64>,
    minutes: Option<i64>,
}

pub fn read_provider_state(provider: &str, cap: i64) -> LocalProviderStateDto {
    match provider {
        "claude-code" => read_cli_state(ClaudeCode, cap),
        "codex" => read_cli_state(Codex, cap),
        other => LocalProviderStateDto::unavailable(&format!("Unknown provider \"{other}\".")),
    }
}

/// What differs between the CLIs. Adding a third means adding one of these,
/// not touching the scanning logic.
trait CliLayout {
    fn name(&self) -> &'static str;
    /// The CLI's state directory, e.g. `~/.claude`.
    fn root(&self) -> Option<PathBuf>;
    /// Directory holding session transcripts, relative to the root.
    fn sessions_dir(&self, root: &Path) -> PathBuf;
    fn unit(&self) -> &'static str;
    fn window(&self) -> &'static str;
    fn window_ms(&self) -> i64;
    /// How much one record contributes to the usage count.
    fn weigh(&self, record: &Record, raw: &str) -> i64;
    /// The visible step this record represents, if any.
    fn step(&self, record: &Record) -> Option<Step>;
    /// Model name, when this record carries one.
    fn model(&self, record: &Record) -> Option<String>;
    /// How this record changes what the agent is waiting on.
    fn signal(&self, record: &Record) -> Option<Signal>;
    /// Shell commands called and their outcomes, for stuck detection.
    fn tool_events(&self, record: &Record) -> Vec<ToolEvent>;
    /// Rate-limit figures the provider sent back, when this record has them.
    fn rate_limits(&self, _record: &Record, _ts: i64) -> Vec<RateWindow> {
        Vec::new()
    }
    /// The provider id hook events are filed under.
    fn id(&self) -> &'static str;
    /// Working directory, when this record carries one.
    fn cwd(&self, record: &Record) -> Option<String> {
        record.cwd.clone()
    }
}

struct ClaudeCode;
struct Codex;

impl CliLayout for ClaudeCode {
    fn name(&self) -> &'static str {
        "Claude Code"
    }
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn tool_events(&self, record: &Record) -> Vec<ToolEvent> {
        let Some(items) = record
            .message
            .as_ref()
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for item in items {
            match item.get("type").and_then(|t| t.as_str()) {
                Some("tool_use") if item.get("name").and_then(|n| n.as_str()) == Some("Bash") => {
                    if let (Some(id), Some(cmd)) = (
                        item.get("id").and_then(|v| v.as_str()),
                        item.get("input")
                            .and_then(|i| i.get("command"))
                            .and_then(|c| c.as_str()),
                    ) {
                        out.push(ToolEvent::Call {
                            id: id.into(),
                            command: cmd.into(),
                        });
                    }
                }
                Some("tool_result") => {
                    if let Some(id) = item.get("tool_use_id").and_then(|v| v.as_str()) {
                        let failed = item
                            .get("is_error")
                            .and_then(|e| e.as_bool())
                            .unwrap_or(false);
                        out.push(ToolEvent::Result {
                            id: id.into(),
                            failed,
                        });
                    }
                }
                _ => {}
            }
        }
        out
    }
    fn root(&self) -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".claude"))
    }
    fn sessions_dir(&self, root: &Path) -> PathBuf {
        root.join("projects")
    }
    fn unit(&self) -> &'static str {
        "tokens"
    }
    fn window(&self) -> &'static str {
        "session"
    }
    fn window_ms(&self) -> i64 {
        5 * 3_600_000
    }

    fn weigh(&self, record: &Record, _raw: &str) -> i64 {
        // Token counts the CLI recorded for its own requests: a local reading
        // of the user's transcript, labelled as such in the UI.
        record
            .message
            .as_ref()
            .and_then(|m| m.get("usage"))
            .map(|u| {
                let get = |k: &str| u.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
                get("input_tokens")
                    + get("output_tokens")
                    + get("cache_creation_input_tokens")
                    + get("cache_read_input_tokens")
            })
            .unwrap_or(0)
    }

    fn step(&self, record: &Record) -> Option<Step> {
        let message = record.message.as_ref()?;
        let content = message.get("content")?;

        match record.kind.as_deref()? {
            // A user record is either a typed prompt or the result of a tool
            // call. Only the first is a step; tool results just close the
            // previous one.
            "user" => {
                let text = match content {
                    serde_json::Value::String(s) => Some(s.as_str()),
                    serde_json::Value::Array(items) => items.iter().find_map(|i| {
                        (i.get("type")?.as_str()? == "text").then(|| i.get("text")?.as_str())?
                    }),
                    _ => None,
                }?;
                let text = text.trim();
                // Command wrappers and system notes are not something the
                // user typed.
                if text.is_empty() || text.starts_with('<') {
                    return None;
                }
                Some(Step {
                    kind: "prompt",
                    label: first_line(text, 64),
                    file: None,
                })
            }
            "assistant" => {
                let tool = content
                    .as_array()?
                    .iter()
                    .find(|i| i.get("type").and_then(|t| t.as_str()) == Some("tool_use"))?;
                let name = tool.get("name")?.as_str()?;
                let input = tool.get("input");
                let field = |k: &str| {
                    input
                        .and_then(|i| i.get(k))
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                };
                Some(match name {
                    "Read" => {
                        let path = field("file_path");
                        Step {
                            kind: "read",
                            label: format!("Read {}", basename(path.as_deref())),
                            file: path,
                        }
                    }
                    "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
                        let path = field("file_path").or_else(|| field("notebook_path"));
                        Step {
                            kind: "edit",
                            label: format!("Edited {}", basename(path.as_deref())),
                            file: path,
                        }
                    }
                    "Grep" | "Glob" => Step {
                        kind: "search",
                        label: format!(
                            "Searched for {}",
                            truncate(&field("pattern").unwrap_or_default(), 40)
                        ),
                        file: None,
                    },
                    "WebFetch" | "WebSearch" => Step {
                        kind: "search",
                        label: "Looked something up".into(),
                        file: None,
                    },
                    "Bash" => command_step(
                        &field("command").unwrap_or_default(),
                        field("description").as_deref(),
                    ),
                    "Task" => Step {
                        kind: "command",
                        label: format!(
                            "Delegated: {}",
                            truncate(&field("description").unwrap_or_default(), 44)
                        ),
                        file: None,
                    },
                    // Bookkeeping tools are not progress the user cares about.
                    "TodoWrite" | "ExitPlanMode" => return None,
                    other => Step {
                        kind: "command",
                        label: format!("Used {other}"),
                        file: None,
                    },
                })
            }
            _ => None,
        }
    }

    fn signal(&self, record: &Record) -> Option<Signal> {
        let message = record.message.as_ref()?;
        let items = message.get("content").and_then(|c| c.as_array());
        let has = |kind: &str| {
            items.is_some_and(|items| {
                items
                    .iter()
                    .any(|i| i.get("type").and_then(|t| t.as_str()) == Some(kind))
            })
        };
        match record.kind.as_deref()? {
            "assistant" if has("tool_use") => Some(Signal::ToolCalled),
            // A reply without a tool call ends the turn, whether or not this
            // CLI version wrote an explicit stop_reason.
            "assistant" if has("text") => Some(Signal::TurnEnded),
            "assistant" => (message.get("stop_reason").and_then(|r| r.as_str())
                == Some("end_turn"))
            .then_some(Signal::TurnEnded),
            "user" if has("tool_result") => Some(Signal::ToolReturned),
            "user" => matches!(self.step(record), Some(Step { kind: "prompt", .. }))
                .then_some(Signal::Prompted),
            _ => None,
        }
    }

    fn model(&self, record: &Record) -> Option<String> {
        record
            .message
            .as_ref()?
            .get("model")?
            .as_str()
            .filter(|m| !m.starts_with('<'))
            .map(str::to_string)
    }
}

impl CliLayout for Codex {
    fn name(&self) -> &'static str {
        "Codex"
    }
    fn id(&self) -> &'static str {
        "codex"
    }

    fn tool_events(&self, record: &Record) -> Vec<ToolEvent> {
        let Some(payload) = record.payload.as_ref() else {
            return Vec::new();
        };
        let call_id = payload
            .get("call_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        match (payload.get("type").and_then(|t| t.as_str()), call_id) {
            (Some("function_call" | "local_shell_call"), Some(id)) => {
                match self.step(record) {
                    Some(Step {
                        kind: "command" | "test" | "git",
                        label,
                        ..
                    }) => {
                        // The label is "Ran <command>"; the command is what repeats.
                        let command = label.strip_prefix("Ran ").unwrap_or(&label).to_string();
                        vec![ToolEvent::Call { id, command }]
                    }
                    _ => Vec::new(),
                }
            }
            (Some("function_call_output" | "custom_tool_call_output"), Some(id)) => {
                match exit_code(payload.get("output")) {
                    Some(code) => vec![ToolEvent::Result {
                        id,
                        failed: code != 0,
                    }],
                    None => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    fn rate_limits(&self, record: &Record, ts: i64) -> Vec<RateWindow> {
        let Some(payload) = record.payload.as_ref() else {
            return Vec::new();
        };
        if payload.get("type").and_then(|t| t.as_str()) != Some("token_count") {
            return Vec::new();
        }
        let Some(limits) = payload
            .get("rate_limits")
            .or_else(|| payload.get("info").and_then(|i| i.get("rate_limits")))
        else {
            return Vec::new();
        };
        ["primary", "secondary"]
            .iter()
            .filter_map(|k| parse_rate_window(limits.get(*k)?, ts))
            .collect()
    }
    fn root(&self) -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".codex"))
    }
    fn sessions_dir(&self, root: &Path) -> PathBuf {
        root.join("sessions")
    }
    fn unit(&self) -> &'static str {
        "requests"
    }
    fn window(&self) -> &'static str {
        "weekly"
    }
    fn window_ms(&self) -> i64 {
        7 * 86_400_000
    }

    fn weigh(&self, record: &Record, _raw: &str) -> i64 {
        // Codex rollouts carry no token counts, so the honest local measure is
        // requests made: one per prompt the user actually typed.
        i64::from(matches!(
            self.step(record),
            Some(Step { kind: "prompt", .. })
        ))
    }

    fn step(&self, record: &Record) -> Option<Step> {
        let payload = record.payload.as_ref()?;
        match payload.get("type")?.as_str()? {
            "message" => {
                if payload.get("role")?.as_str()? != "user" {
                    return None;
                }
                let text = payload
                    .get("content")?
                    .as_array()?
                    .iter()
                    .find_map(|i| i.get("text")?.as_str())?
                    .trim();
                // Environment and instruction blocks are injected, not typed.
                if text.is_empty() || text.starts_with('<') {
                    return None;
                }
                Some(Step {
                    kind: "prompt",
                    label: first_line(text, 64),
                    file: None,
                })
            }
            "function_call" | "custom_tool_call" | "local_shell_call" => {
                let name = payload
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("shell");
                let args: serde_json::Value = payload
                    .get("arguments")
                    .or_else(|| payload.get("input"))
                    .map(|a| match a {
                        serde_json::Value::String(s) => {
                            serde_json::from_str(s).unwrap_or(serde_json::Value::String(s.clone()))
                        }
                        other => other.clone(),
                    })
                    .unwrap_or(serde_json::Value::Null);

                if name == "apply_patch" {
                    let patch = args.as_str().map(str::to_string).unwrap_or_else(|| {
                        args.get("input")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string()
                    });
                    let file = patch.lines().find_map(|l| {
                        l.strip_prefix("*** Update File: ")
                            .or_else(|| l.strip_prefix("*** Add File: "))
                            .map(|p| p.trim().to_string())
                    });
                    return Some(Step {
                        kind: "edit",
                        label: format!("Edited {}", basename(file.as_deref())),
                        file,
                    });
                }

                let command = match args.get("command") {
                    Some(serde_json::Value::Array(parts)) => {
                        let parts: Vec<&str> = parts.iter().filter_map(|p| p.as_str()).collect();
                        // `bash -lc "<script>"` — the script is the command.
                        match parts.as_slice() {
                            [_, flag, script] if flag.starts_with('-') => script.to_string(),
                            _ => parts.join(" "),
                        }
                    }
                    Some(serde_json::Value::String(s)) => s.clone(),
                    _ => args
                        .get("cmd")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string(),
                };
                if command.is_empty() {
                    return Some(Step {
                        kind: "command",
                        label: format!("Used {name}"),
                        file: None,
                    });
                }
                Some(command_step(&command, None))
            }
            _ => None,
        }
    }

    fn signal(&self, record: &Record) -> Option<Signal> {
        let payload = record.payload.as_ref()?;
        match payload.get("type")?.as_str()? {
            "function_call" | "custom_tool_call" | "local_shell_call" => Some(Signal::ToolCalled),
            "function_call_output" | "custom_tool_call_output" => Some(Signal::ToolReturned),
            "task_complete" | "turn_complete" => Some(Signal::TurnEnded),
            "message" => match payload.get("role")?.as_str()? {
                "assistant" => Some(Signal::TurnEnded),
                "user" => matches!(self.step(record), Some(Step { kind: "prompt", .. }))
                    .then_some(Signal::Prompted),
                _ => None,
            },
            _ => None,
        }
    }

    fn model(&self, record: &Record) -> Option<String> {
        let payload = record.payload.as_ref()?;
        payload.get("model")?.as_str().map(str::to_string)
    }

    fn cwd(&self, record: &Record) -> Option<String> {
        record.cwd.clone().or_else(|| {
            record
                .payload
                .as_ref()?
                .get("cwd")?
                .as_str()
                .map(str::to_string)
        })
    }
}

/// Classifies a shell command into a step. Tests and git get their own kinds
/// because they are the moments a user most wants to see.
fn command_step(command: &str, description: Option<&str>) -> Step {
    let c = command.trim();
    let is_test = [
        "test",
        "pytest",
        "jest",
        "vitest",
        "mocha",
        "rspec",
        "go test",
        "cargo nextest",
    ]
    .iter()
    .any(|t| c.contains(t));
    let kind = if c.starts_with("git ") {
        "git"
    } else if is_test {
        "test"
    } else {
        "command"
    };
    let label = match description.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => truncate(d, 52),
        None => format!("Ran {}", truncate(first_line(c, 200).as_str(), 46)),
    };
    Step {
        kind,
        label,
        file: None,
    }
}

/// The exit code from a Codex tool output, which is either JSON with
/// `metadata.exit_code` or text containing "Exit code: N".
fn exit_code(output: Option<&serde_json::Value>) -> Option<i64> {
    let output = output?;
    let text = match output {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(code) = v
            .get("metadata")
            .and_then(|m| m.get("exit_code"))
            .and_then(|c| c.as_i64())
        {
            return Some(code);
        }
    }
    let lower = text.to_ascii_lowercase();
    let at = lower.find("exit code:")?;
    lower[at + "exit code:".len()..]
        .trim_start()
        .split(|c: char| !c.is_ascii_digit() && c != '-')
        .next()?
        .parse()
        .ok()
}

fn parse_rate_window(v: &serde_json::Value, ts: i64) -> Option<RateWindow> {
    let used_percent = v.get("used_percent")?.as_f64()?;
    let resets_at = v
        .get("resets_at")
        .and_then(|r| r.as_i64())
        .map(|s| if s < 100_000_000_000 { s * 1000 } else { s })
        .or_else(|| {
            v.get("resets_in_seconds")
                .and_then(|r| r.as_i64())
                .map(|s| ts + s * 1000)
        });
    Some(RateWindow {
        used_percent,
        resets_at,
        minutes: v.get("window_minutes").and_then(|m| m.as_i64()),
    })
}

/// Rolling limits open a window at the first use after the previous window
/// closed, and reset when it closes. Given every counted use, returns the
/// current window's start and the usage inside it, or None if none is open.
fn current_window(mut uses: Vec<(i64, i64)>, len: i64, now: i64) -> Option<(i64, i64)> {
    uses.retain(|(_, w)| *w > 0);
    uses.sort_by_key(|(ts, _)| *ts);
    let mut window: Option<(i64, i64)> = None;
    for (ts, w) in uses {
        window = match window {
            Some((start, used)) if ts < start + len => Some((start, used + w)),
            _ => Some((ts, w)),
        };
    }
    window.filter(|(start, _)| now < start + len)
}

/// How many recent command outcomes to look back over.
const STUCK_LOOKBACK: usize = 20;
/// Failures of one command before an agent counts as stuck.
const STUCK_FAILURES: usize = 3;

/// The agent is stuck when one command has failed at least three times in
/// its recent commands and its latest run failed too: an edit, test, fail
/// loop shows up as the test command failing over and over.
fn detect_stuck(outcomes: &[(String, bool)]) -> Option<StuckDto> {
    let recent = &outcomes[outcomes.len().saturating_sub(STUCK_LOOKBACK)..];
    let (command, _) = recent.iter().rev().find(|(_, failed)| *failed)?;
    let latest_for_command = recent.iter().rev().find(|(c, _)| c == command)?;
    if !latest_for_command.1 {
        return None;
    }
    let failures = recent.iter().filter(|(c, f)| c == command && *f).count();
    (failures >= STUCK_FAILURES).then(|| StuckDto {
        command: truncate(command, 48),
        failures: failures as i64,
    })
}

fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn read_cli_state<L: CliLayout>(layout: L, cap: i64) -> LocalProviderStateDto {
    let Some(root) = layout.root() else {
        return LocalProviderStateDto::unavailable("Could not locate your home directory.");
    };

    if !root.exists() {
        return LocalProviderStateDto::unavailable(&format!(
            "{} state not found — run the CLI at least once.",
            layout.name()
        ));
    }

    let sessions_dir = layout.sessions_dir(&root);
    if !sessions_dir.exists() {
        return LocalProviderStateDto::unavailable(&format!(
            "No {} sessions recorded yet.",
            layout.name()
        ));
    }

    let now = now_ms();
    let files = collect_recent_jsonl(&sessions_dir, now);

    let mut sessions = Vec::new();
    let mut activities = Vec::new();
    // Every counted use from the last two windows, to find the current one.
    let since = now - 2 * layout.window_ms();
    let mut uses: Vec<(i64, i64)> = Vec::new();
    let mut reported: Option<(i64, Vec<RateWindow>)> = None;

    for (path, modified) in files {
        let Some(scan) = scan_session(&path, &layout, since) else {
            continue;
        };
        uses.extend(scan.uses.iter().copied());
        if let Some((ts, windows)) = &scan.rate_limits {
            if reported.as_ref().is_none_or(|(prev, _)| ts > prev) {
                reported = Some((*ts, windows.clone()));
            }
        }

        // Prefer the id the CLI recorded; fall back to the file name.
        let id = scan.session_id.clone().unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("session")
                .to_string()
        });

        let project_path = scan
            .cwd
            .clone()
            .unwrap_or_else(|| decode_project_dir(&path));
        let project = Path::new(&project_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let merged = merge_runs(&scan.steps);
        let files_changed = count_files(&scan.steps);

        // The activity feed is the merged steps, so it reads the same way the
        // card does instead of listing every file read separately.
        for (i, (step, ts, _)) in merged.iter().enumerate() {
            activities.push(LocalActivityDto {
                id: format!("{id}-{i}"),
                session_id: Some(id.clone()),
                project: Some(project.clone()),
                kind: activity_type(step).to_string(),
                message: step.label.clone(),
                timestamp: *ts,
            });
        }

        let tail_start = merged.len().saturating_sub(MAX_STEPS);
        let steps: Vec<LocalStepDto> = merged[tail_start..]
            .iter()
            .enumerate()
            .map(|(i, (step, ts, dur))| LocalStepDto {
                id: format!("{id}-step-{}", tail_start + i),
                kind: step.kind.to_string(),
                label: step.label.clone(),
                started_at: *ts,
                duration_ms: *dur,
            })
            .collect();

        let last_activity_at = scan.last_ts.unwrap_or(modified);
        let current_activity = steps
            .last()
            .map(|s| s.label.clone())
            .unwrap_or_else(|| "Working".to_string());

        sessions.push(LocalSessionDto {
            id,
            project,
            project_path,
            // The webview decides running-vs-waiting from the timestamp, so
            // the rule lives in one place rather than two.
            status: "active".to_string(),
            started_at: scan.first_ts.unwrap_or(modified),
            last_activity_at,
            current_activity,
            event_count: scan.event_count,
            model: scan.model,
            steps,
            files_changed,
            turn_ended: scan.turn_ended,
            pending_tool: scan.pending_tool,
            stuck: detect_stuck(&scan.outcomes),
            hook: None,
        });
    }

    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
    attach_hook_events(layout.id(), &mut sessions, &crate::hooks::read_events());
    activities.sort_by_key(|a| std::cmp::Reverse(a.timestamp));
    activities.truncate(MAX_ACTIVITIES);

    let usage = Some(match reported {
        // The provider's own figures win. A window whose reset time has
        // passed is empty again, whatever it said when it was reported.
        Some((_, windows)) => {
            let live = windows
                .iter()
                .map(|w| match w.resets_at {
                    Some(at) if at <= now => RateWindow {
                        used_percent: 0.0,
                        resets_at: None,
                        ..*w
                    },
                    _ => *w,
                })
                .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent));
            LocalUsageDto {
                used: 0,
                cap: cap.max(1),
                reset_at: live.and_then(|w| w.resets_at),
                unit: layout.unit().to_string(),
                window: match live.and_then(|w| w.minutes) {
                    Some(m) if m > 24 * 60 => "weekly",
                    _ => "session",
                }
                .to_string(),
                used_percent: Some(live.map_or(0.0, |w| w.used_percent)),
                source: "provider".to_string(),
            }
        }
        None => {
            let window = current_window(uses, layout.window_ms(), now);
            LocalUsageDto {
                used: window.map_or(0, |(_, used)| used),
                cap: cap.max(1),
                reset_at: window.map(|(start, _)| start + layout.window_ms()),
                unit: layout.unit().to_string(),
                window: layout.window().to_string(),
                used_percent: None,
                source: "local".to_string(),
            }
        }
    });

    LocalProviderStateDto {
        available: true,
        detail: None,
        sessions,
        activities,
        usage,
    }
}

fn activity_type(step: &Step) -> &'static str {
    match step.kind {
        "edit" => "file-edited",
        "prompt" => "session-started",
        "test" if step.label.starts_with("Passed") => "task-completed",
        _ => "command-run",
    }
}

/// Collapses runs of the same kind into one step: twelve consecutive reads
/// become "Read 12 files", which is what a glance needs. Returns each merged
/// step with its start time and its duration (until the next step began).
fn merge_runs(steps: &[(Step, i64)]) -> Vec<(Step, i64, Option<i64>)> {
    let mut groups: Vec<(Step, i64, usize)> = Vec::new();
    for (step, ts) in steps {
        match groups.last_mut() {
            Some((prev, _, count))
                if prev.kind == step.kind && matches!(step.kind, "read" | "search" | "edit") =>
            {
                *count += 1;
                *prev = step.clone();
            }
            _ => groups.push((step.clone(), *ts, 1)),
        }
    }

    let starts: Vec<i64> = groups.iter().map(|(_, ts, _)| *ts).collect();
    groups
        .into_iter()
        .enumerate()
        .map(|(i, (step, ts, count))| {
            let label = if count > 1 {
                match step.kind {
                    "read" => format!("Read {count} files"),
                    "edit" => format!("Edited {count} files"),
                    _ => format!("Ran {count} searches"),
                }
            } else {
                step.label
            };
            let duration = starts.get(i + 1).map(|next| (next - ts).max(0));
            (Step { label, ..step }, ts, duration)
        })
        .collect()
}

fn count_files(steps: &[(Step, i64)]) -> i64 {
    let mut seen = std::collections::HashSet::new();
    for (step, _) in steps {
        if step.kind == "edit" {
            if let Some(file) = &step.file {
                seen.insert(file.as_str());
            }
        }
    }
    seen.len() as i64
}

fn basename(path: Option<&str>) -> String {
    path.and_then(|p| Path::new(p).file_name())
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "a file".to_string())
}

/// Truncates on a character boundary, never mid-codepoint.
fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn first_line(s: &str, max: usize) -> String {
    truncate(s.lines().next().unwrap_or(""), max)
}

/// Gives each session the newest hook event that belongs to it and arrived
/// after its last transcript write. Matching is by session id; Codex's notify
/// may carry a different id, so it falls back to the newest session in the
/// same folder.
fn attach_hook_events(
    provider: &str,
    sessions: &mut [LocalSessionDto],
    events: &[crate::hooks::HookEvent],
) {
    // A hook fires just after the agent writes; allow for that ordering.
    const SKEW_MS: i64 = 3_000;
    for event in events.iter().filter(|e| e.provider == provider) {
        let target = sessions
            .iter()
            .position(|s| event.session_id.as_deref() == Some(s.id.as_str()))
            .or_else(|| {
                let cwd = event.cwd.as_deref()?;
                // Sessions are newest first, so the first match is the newest.
                sessions.iter().position(|s| s.project_path == cwd)
            });
        let Some(i) = target else { continue };
        let session = &mut sessions[i];
        if event.ts + SKEW_MS < session.last_activity_at {
            continue;
        }
        if session.hook.as_ref().is_none_or(|h| event.ts >= h.at) {
            session.hook = Some(HookStateDto {
                kind: event.kind.clone(),
                message: event.message.clone(),
                at: event.ts,
            });
        }
    }
}

struct SessionScan {
    session_id: Option<String>,
    first_ts: Option<i64>,
    last_ts: Option<i64>,
    cwd: Option<String>,
    model: Option<String>,
    weighted: i64,
    /// (timestamp, weight) of each counted use since the lower bound.
    uses: Vec<(i64, i64)>,
    event_count: i64,
    steps: Vec<(Step, i64)>,
    turn_ended: bool,
    pending_tool: bool,
    /// Shell commands in order, with whether each failed.
    outcomes: Vec<(String, bool)>,
    /// The newest rate-limit report and when it was made.
    rate_limits: Option<(i64, Vec<RateWindow>)>,
}

/// Reads the head of a transcript for its origin, and the tail for what is
/// happening now. The middle is never read — it is the expensive part and it
/// answers none of the panel's three questions.
fn scan_session<L: CliLayout>(path: &Path, layout: &L, window_start: i64) -> Option<SessionScan> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();

    let mut scan = SessionScan {
        session_id: None,
        first_ts: None,
        last_ts: None,
        cwd: None,
        model: None,
        weighted: 0,
        uses: Vec::new(),
        event_count: 0,
        steps: Vec::new(),
        turn_ended: false,
        pending_tool: false,
        outcomes: Vec::new(),
        rate_limits: None,
    };
    let mut calls: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Head: the first line carries the project and the start time.
    {
        let mut head = String::new();
        let mut reader = BufReader::new(&file);
        if reader.read_line(&mut head).ok()? > 0 {
            if let Ok(record) = serde_json::from_str::<Record>(head.trim()) {
                scan.cwd = layout.cwd(&record);
                scan.session_id = record.session_id.clone();
                scan.first_ts = parse_ts(&record);
                scan.model = layout.model(&record);
            }
        }
    }

    // Tail: the recent records, which is where "right now" lives.
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity(TAIL_BYTES as usize);
    file.take(TAIL_BYTES).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);

    // A mid-file seek almost always lands inside a line; drop that fragment.
    let mut lines = text.lines().peekable();
    if start > 0 {
        lines.next();
    }

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Record>(line) else {
            continue;
        };

        scan.event_count += 1;
        if scan.cwd.is_none() {
            scan.cwd = layout.cwd(&record);
        }
        if scan.session_id.is_none() {
            scan.session_id = record.session_id.clone();
        }
        // The latest model wins: a session can switch models mid-way.
        if let Some(model) = layout.model(&record) {
            scan.model = Some(model);
        }

        let Some(ts) = parse_ts(&record) else {
            continue;
        };
        scan.last_ts = Some(scan.last_ts.map_or(ts, |prev: i64| prev.max(ts)));
        if scan.first_ts.is_none() {
            scan.first_ts = Some(ts);
        }
        // Only uses since the lower bound can belong to the current window.
        if ts >= window_start {
            let w = layout.weigh(&record, line);
            scan.weighted += w;
            if w > 0 {
                scan.uses.push((ts, w));
            }
        }
        for event in layout.tool_events(&record) {
            match event {
                ToolEvent::Call { id, command } => {
                    calls.insert(id, normalize_command(&command));
                }
                ToolEvent::Result { id, failed } => {
                    if let Some(command) = calls.remove(&id) {
                        scan.outcomes.push((command, failed));
                    }
                }
            }
        }
        let windows = layout.rate_limits(&record, ts);
        if !windows.is_empty() {
            scan.rate_limits = Some((ts, windows));
        }
        if let Some(step) = layout.step(&record) {
            scan.steps.push((step, ts));
        }
        match layout.signal(&record) {
            Some(Signal::Prompted) => {
                scan.turn_ended = false;
                scan.pending_tool = false;
            }
            Some(Signal::ToolCalled) => {
                scan.turn_ended = false;
                scan.pending_tool = true;
            }
            Some(Signal::ToolReturned) => scan.pending_tool = false,
            Some(Signal::TurnEnded) => {
                scan.turn_ended = true;
                scan.pending_tool = false;
            }
            None => {}
        }
    }

    Some(scan)
}

/// Walks the sessions tree for recent `.jsonl` files, newest first.
///
/// Bounded in both directions: anything older than the window is skipped by
/// its mtime without being opened, and only the newest handful are returned.
fn collect_recent_jsonl(dir: &Path, now: i64) -> Vec<(PathBuf, i64)> {
    let mut found: Vec<(PathBuf, i64)> = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    // Guards against a pathological tree costing the panel its open latency.
    let mut visited = 0usize;

    while let Some(current) = stack.pop() {
        visited += 1;
        if visited > 2_000 {
            break;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if now - modified > SESSION_MAX_AGE_MS {
                continue;
            }
            found.push((path, modified));
        }
    }

    found.sort_by_key(|f| std::cmp::Reverse(f.1));
    found.truncate(MAX_SESSION_FILES);
    found
}

/// Claude Code encodes a project path into its directory name by replacing
/// separators with dashes. The original is ambiguous, so this is best-effort
/// and only used when no record carried an explicit `cwd`.
fn decode_project_dir(path: &Path) -> String {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .map(|name| name.replace('-', "/"))
        .unwrap_or_else(|| "unknown".to_string())
}

fn parse_ts(record: &Record) -> Option<i64> {
    if let Some(raw) = &record.timestamp {
        if let Some(ms) = parse_rfc3339_ms(raw) {
            return Some(ms);
        }
    }
    if let Some(value) = &record.ts {
        if let Some(n) = value.as_i64() {
            // Accept seconds or milliseconds; both appear in the wild.
            return Some(if n < 100_000_000_000 { n * 1000 } else { n });
        }
        if let Some(s) = value.as_str() {
            return parse_rfc3339_ms(s);
        }
    }
    record
        .payload
        .as_ref()
        .and_then(|p| p.get("timestamp"))
        .and_then(|v| v.as_str())
        .and_then(parse_rfc3339_ms)
}

/// Minimal RFC 3339 parse for the `YYYY-MM-DDTHH:MM:SS(.sss)Z` the CLIs emit.
/// A date crate would be a dependency for one format we fully control.
fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let year = num(0, 4)?;
    let month = num(5, 7)?;
    let day = num(8, 10)?;
    let hour = num(11, 13)?;
    let minute = num(14, 16)?;
    let second = num(17, 19)?;
    let millis = s
        .get(20..23)
        .filter(|m| m.chars().all(|c| c.is_ascii_digit()))
        .and_then(|m| m.parse::<i64>().ok())
        .unwrap_or(0);

    let days = days_from_civil(year, month, day);
    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000) + millis)
}

/// Howard Hinnant's days-from-civil: calendar date to days since the epoch.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Directories to watch for change, so refreshes are event-driven.
pub fn watch_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for candidate in [home.join(".claude/projects"), home.join(".codex/sessions")] {
            if candidate.exists() {
                roots.push(candidate);
            }
        }
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn record(json: &str) -> Record {
        serde_json::from_str(json).expect("valid test record")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("acc-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_rfc3339_with_and_without_millis() {
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T00:00:00Z"),
            Some(1_704_067_200_000)
        );
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T00:00:00.250Z"),
            Some(1_704_067_200_250)
        );
        assert_eq!(
            parse_rfc3339_ms("2024-02-29T12:00:00Z"),
            Some(1_709_208_000_000)
        );
        assert_eq!(parse_rfc3339_ms("nope"), None);
    }

    #[test]
    fn epoch_round_trips_through_days_from_civil() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11017);
    }

    #[test]
    fn accepts_second_and_millisecond_epochs() {
        assert_eq!(
            parse_ts(&record(r#"{"ts": 1704067200}"#)),
            Some(1_704_067_200_000)
        );
        assert_eq!(
            parse_ts(&record(r#"{"ts": 1704067200000}"#)),
            Some(1_704_067_200_000)
        );
    }

    #[test]
    fn claude_weighs_every_token_bucket() {
        let r = record(
            r#"{"type":"assistant","message":{"usage":{
                "input_tokens":10,"output_tokens":5,
                "cache_creation_input_tokens":2,"cache_read_input_tokens":3}}}"#,
        );
        assert_eq!(ClaudeCode.weigh(&r, ""), 20);
    }

    /// Regression: tool results arrive as `type: "user"` records and must not
    /// be mistaken for prompts the user typed.
    #[test]
    fn claude_tool_results_are_not_prompts() {
        let tool_result = record(
            r#"{"type":"user","message":{"role":"user","content":[
                {"type":"tool_result","tool_use_id":"x","content":"ok"}]}}"#,
        );
        assert_eq!(ClaudeCode.step(&tool_result), None);

        let typed =
            record(r#"{"type":"user","message":{"role":"user","content":"Fix the flaky test"}}"#);
        assert_eq!(ClaudeCode.step(&typed).unwrap().kind, "prompt");

        let wrapper = record(
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}"#,
        );
        assert_eq!(ClaudeCode.step(&wrapper), None);
    }

    #[test]
    fn claude_tool_calls_become_named_steps() {
        let edit = record(
            r#"{"type":"assistant","message":{"content":[
                {"type":"tool_use","name":"Edit","input":{"file_path":"/repo/src/invoice.ts"}}]}}"#,
        );
        let step = ClaudeCode.step(&edit).unwrap();
        assert_eq!(step.kind, "edit");
        assert_eq!(step.label, "Edited invoice.ts");

        let tests = record(
            r#"{"type":"assistant","message":{"content":[
                {"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}"#,
        );
        assert_eq!(ClaudeCode.step(&tests).unwrap().kind, "test");

        let described = record(
            r#"{"type":"assistant","message":{"content":[
                {"type":"tool_use","name":"Bash","input":{"command":"git push","description":"Push the fix"}}]}}"#,
        );
        let step = ClaudeCode.step(&described).unwrap();
        assert_eq!((step.kind, step.label.as_str()), ("git", "Push the fix"));

        let todo = record(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TodoWrite","input":{}}]}}"#,
        );
        assert_eq!(ClaudeCode.step(&todo), None);
    }

    #[test]
    fn claude_reads_the_model() {
        let r = record(
            r#"{"type":"assistant","message":{"model":"claude-sonnet-4-5-20250929","content":[]}}"#,
        );
        assert_eq!(
            ClaudeCode.model(&r).as_deref(),
            Some("claude-sonnet-4-5-20250929")
        );
    }

    /// Regression: Codex wraps everything in `payload`; the old matcher looked
    /// at the top level and never recognised a single Codex event.
    #[test]
    fn codex_payload_records_are_understood() {
        let prompt = record(
            r#"{"type":"response_item","payload":{"type":"message","role":"user",
                "content":[{"type":"input_text","text":"Fix proration rounding"}]}}"#,
        );
        let step = Codex.step(&prompt).unwrap();
        assert_eq!(
            (step.kind, step.label.as_str()),
            ("prompt", "Fix proration rounding")
        );
        assert_eq!(Codex.weigh(&prompt, ""), 1);

        let injected = record(
            r#"{"type":"response_item","payload":{"type":"message","role":"user",
                "content":[{"type":"input_text","text":"<environment_context>...</environment_context>"}]}}"#,
        );
        assert_eq!(Codex.step(&injected), None);
        assert_eq!(Codex.weigh(&injected, ""), 0);

        let shell = record(
            r#"{"type":"response_item","payload":{"type":"function_call","name":"shell",
                "arguments":"{\"command\":[\"bash\",\"-lc\",\"cargo test --lib\"]}"}}"#,
        );
        let step = Codex.step(&shell).unwrap();
        assert_eq!(step.kind, "test");
        assert_eq!(step.label, "Ran cargo test --lib");
        assert_eq!(Codex.weigh(&shell, ""), 0);

        let patch = record(
            r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch",
                "input":"*** Begin Patch\n*** Update File: src/billing/invoice.ts\n@@\n*** End Patch"}}"#,
        );
        let step = Codex.step(&patch).unwrap();
        assert_eq!(
            (step.kind, step.label.as_str()),
            ("edit", "Edited invoice.ts")
        );
    }

    #[test]
    fn codex_reads_cwd_and_model_from_payload() {
        let meta =
            record(r#"{"type":"session_meta","payload":{"cwd":"/Users/dev/code/opspulse"}}"#);
        assert_eq!(
            Codex.cwd(&meta).as_deref(),
            Some("/Users/dev/code/opspulse")
        );
        let ctx = record(r#"{"type":"turn_context","payload":{"model":"gpt-5-codex"}}"#);
        assert_eq!(Codex.model(&ctx).as_deref(), Some("gpt-5-codex"));
    }

    #[test]
    fn runs_of_reads_merge_and_carry_durations() {
        let s = |kind, label: &str, file: Option<&str>| Step {
            kind,
            label: label.into(),
            file: file.map(str::to_string),
        };
        let steps = vec![
            (s("read", "Read a.ts", Some("a.ts")), 1_000),
            (s("read", "Read b.ts", Some("b.ts")), 2_000),
            (s("read", "Read c.ts", Some("c.ts")), 3_000),
            (s("edit", "Edited a.ts", Some("a.ts")), 5_000),
            (s("test", "Ran npm test", None), 9_000),
        ];
        let merged = merge_runs(&steps);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].0.label, "Read 3 files");
        assert_eq!(merged[0].1, 1_000);
        assert_eq!(merged[0].2, Some(4_000));
        assert_eq!(merged[1].0.label, "Edited a.ts");
        assert_eq!(merged[2].2, None, "the latest step is still open");
        assert_eq!(count_files(&steps), 1);
    }

    #[test]
    fn truncation_respects_character_boundaries() {
        assert_eq!(truncate("héllo wörld", 6), "héllo…");
        assert_eq!(truncate("short", 10), "short");
    }

    #[test]
    fn missing_provider_root_is_reported_not_faked() {
        let state = read_provider_state("definitely-not-a-provider", 100);
        assert!(!state.available);
        assert!(state.usage.is_none());
        assert!(state.detail.is_some());
    }

    /// End to end: a transcript on disk becomes a session with the right
    /// project, model, steps and usage, reading head and tail only.
    #[test]
    fn scans_a_claude_transcript_end_to_end() {
        let dir = temp_dir("claude");
        let project_dir = dir.join("-Users-dev-code-motionlib");
        std::fs::create_dir_all(&project_dir).unwrap();
        let path = project_dir.join("abc-123.jsonl");

        let mut f = std::fs::File::create(&path).unwrap();
        for line in [
            r#"{"type":"user","sessionId":"abc-123","cwd":"/Users/dev/code/motionlib","timestamp":"2024-01-01T10:00:00Z","message":{"role":"user","content":"Add spring presets"}}"#,
            r#"{"type":"assistant","timestamp":"2024-01-01T10:00:05Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":100,"output_tokens":50},"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/r/a.ts"}}]}}"#,
            r#"{"type":"user","timestamp":"2024-01-01T10:00:06Z","message":{"role":"user","content":[{"type":"tool_result","content":"..."}]}}"#,
            r#"{"type":"assistant","timestamp":"2024-01-01T10:05:00Z","message":{"usage":{"input_tokens":10,"output_tokens":5},"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/r/spring.ts"}}]}}"#,
        ] {
            writeln!(f, "{line}").unwrap();
        }
        drop(f);

        let scan = scan_session(&path, &ClaudeCode, 0).expect("scan should succeed");
        assert_eq!(scan.session_id.as_deref(), Some("abc-123"));
        assert_eq!(scan.cwd.as_deref(), Some("/Users/dev/code/motionlib"));
        assert_eq!(scan.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(scan.first_ts, parse_rfc3339_ms("2024-01-01T10:00:00Z"));
        assert_eq!(scan.last_ts, parse_rfc3339_ms("2024-01-01T10:05:00Z"));
        assert_eq!(scan.weighted, 165);

        let kinds: Vec<&str> = scan.steps.iter().map(|(s, _)| s.kind).collect();
        assert_eq!(
            kinds,
            ["prompt", "read", "edit"],
            "tool results are not steps"
        );

        // Records outside the window must not count against the limit.
        let later = scan_session(&path, &ClaudeCode, now_ms() + 86_400_000).unwrap();
        assert_eq!(later.weighted, 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    fn fold<L: CliLayout>(layout: &L, lines: &[&str]) -> (bool, bool) {
        let (mut ended, mut pending) = (false, false);
        for line in lines {
            match layout.signal(&record(line)) {
                Some(Signal::Prompted) => (ended, pending) = (false, false),
                Some(Signal::ToolCalled) => (ended, pending) = (false, true),
                Some(Signal::ToolReturned) => pending = false,
                Some(Signal::TurnEnded) => (ended, pending) = (true, false),
                None => {}
            }
        }
        (ended, pending)
    }

    #[test]
    fn claude_states_follow_the_transcript() {
        let prompt = r#"{"type":"user","message":{"role":"user","content":"Fix it"}}"#;
        let call = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}"#;
        let result = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#;
        let reply = r#"{"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"Done."}]}}"#;

        assert_eq!(
            fold(&ClaudeCode, &[prompt, call]),
            (false, true),
            "waiting on a tool"
        );
        assert_eq!(
            fold(&ClaudeCode, &[prompt, call, result]),
            (false, false),
            "working"
        );
        assert_eq!(
            fold(&ClaudeCode, &[prompt, call, result, reply]),
            (true, false),
            "finished"
        );
        assert_eq!(
            fold(&ClaudeCode, &[prompt, call, result, reply, prompt]),
            (false, false),
            "resumed"
        );
    }

    #[test]
    fn codex_states_follow_the_rollout() {
        let prompt = r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix it"}]}}"#;
        let call = r#"{"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"ls\"]}"}}"#;
        let output =
            r#"{"type":"response_item","payload":{"type":"function_call_output","output":"ok"}}"#;
        let done = r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#;

        assert_eq!(fold(&Codex, &[prompt, call]), (false, true));
        assert_eq!(fold(&Codex, &[prompt, call, output]), (false, false));
        assert_eq!(fold(&Codex, &[prompt, call, output, done]), (true, false));
    }

    #[test]
    fn decodes_a_project_directory_name() {
        let path = Path::new("/home/u/.claude/projects/-Users-dev-code-opspulse/s.jsonl");
        assert_eq!(decode_project_dir(path), "/Users/dev/code/opspulse");
    }

    const H: i64 = 3_600_000;

    #[test]
    fn windows_open_at_first_use_and_reset_after_their_length() {
        let len = 5 * H;
        // Uses at 0h and 2h share a window; 6h opens a new one.
        let uses = vec![(0, 10), (2 * H, 5), (6 * H, 7), (7 * H, 1)];
        assert_eq!(current_window(uses.clone(), len, 8 * H), Some((6 * H, 8)));
        // Before 6h, the first window is current with both early uses.
        assert_eq!(
            current_window(uses[..2].to_vec(), len, 3 * H),
            Some((0, 15))
        );
        // Once a window has closed and nothing new happened, none is open.
        assert_eq!(current_window(uses[..2].to_vec(), len, 5 * H + 1), None);
        // Zero-weight records never open a window.
        assert_eq!(current_window(vec![(0, 0)], len, 1), None);
    }

    #[test]
    fn stuck_needs_three_failures_and_a_failing_latest_run() {
        let o = |c: &str, f: bool| (c.to_string(), f);
        let stuck = detect_stuck(&[
            o("npm test", true),
            o("cat a.ts", false),
            o("npm test", true),
            o("npm test", true),
        ])
        .unwrap();
        assert_eq!((stuck.command.as_str(), stuck.failures), ("npm test", 3));

        // Fixed on the latest run: not stuck any more.
        assert!(detect_stuck(&[
            o("npm test", true),
            o("npm test", true),
            o("npm test", true),
            o("npm test", false)
        ])
        .is_none());
        // Two failures is persistence, not stuck.
        assert!(detect_stuck(&[o("npm test", true), o("npm test", true)]).is_none());
        // Different commands failing do not add up.
        assert!(detect_stuck(&[o("a", true), o("b", true), o("c", true)]).is_none());
    }

    #[test]
    fn reads_codex_exit_codes_in_both_formats() {
        let j = |s: &str| serde_json::Value::String(s.to_string());
        assert_eq!(
            exit_code(Some(&j(
                r#"{"output":"...","metadata":{"exit_code":1,"duration_seconds":0.2}}"#
            ))),
            Some(1)
        );
        assert_eq!(
            exit_code(Some(&j(r#"{"output":"ok","metadata":{"exit_code":0}}"#))),
            Some(0)
        );
        assert_eq!(
            exit_code(Some(&j("Exit code: 2\nWall time: 1s\nOutput: boom"))),
            Some(2)
        );
        assert_eq!(exit_code(Some(&j("no code here"))), None);
    }

    #[test]
    fn claude_bash_failures_feed_stuck_detection() {
        let call = record(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm   test"}}]}}"#,
        );
        let fail = record(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"1 failed"}]}}"#,
        );
        assert_eq!(
            ClaudeCode.tool_events(&call),
            vec![ToolEvent::Call {
                id: "t1".into(),
                command: "npm   test".into()
            }]
        );
        assert_eq!(
            ClaudeCode.tool_events(&fail),
            vec![ToolEvent::Result {
                id: "t1".into(),
                failed: true
            }]
        );
        assert_eq!(normalize_command("npm   test"), "npm test");
    }

    #[test]
    fn codex_shell_calls_and_outputs_pair_up() {
        let call = record(
            r#"{"type":"response_item","payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\"command\":[\"bash\",\"-lc\",\"cargo test\"]}"}}"#,
        );
        let out = record(
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"{\"output\":\"x\",\"metadata\":{\"exit_code\":101}}"}}"#,
        );
        assert_eq!(
            Codex.tool_events(&call),
            vec![ToolEvent::Call {
                id: "c1".into(),
                command: "cargo test".into()
            }]
        );
        assert_eq!(
            Codex.tool_events(&out),
            vec![ToolEvent::Result {
                id: "c1".into(),
                failed: true
            }]
        );
    }

    #[test]
    fn codex_reported_rate_limits_are_parsed() {
        let ts = 1_000_000;
        let r = record(
            r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{
            "primary":{"used_percent":12.5,"window_minutes":299,"resets_in_seconds":600},
            "secondary":{"used_percent":40.0,"window_minutes":10079,"resets_at":1700000000}}}}"#,
        );
        let w = Codex.rate_limits(&r, ts);
        assert_eq!(w.len(), 2);
        assert_eq!(
            w[0],
            RateWindow {
                used_percent: 12.5,
                resets_at: Some(ts + 600_000),
                minutes: Some(299)
            }
        );
        assert_eq!(
            w[1].resets_at,
            Some(1_700_000_000_000),
            "seconds become milliseconds"
        );
        // Other records carry nothing.
        assert!(Codex
            .rate_limits(
                &record(r#"{"type":"event_msg","payload":{"type":"agent_message"}}"#),
                ts
            )
            .is_empty());
        assert!(ClaudeCode.rate_limits(&r, ts).is_empty());
    }

    fn session(id: &str, path: &str, last: i64) -> LocalSessionDto {
        LocalSessionDto {
            id: id.into(),
            project: "p".into(),
            project_path: path.into(),
            status: "active".into(),
            started_at: 0,
            last_activity_at: last,
            current_activity: String::new(),
            event_count: 0,
            model: None,
            steps: Vec::new(),
            files_changed: 0,
            turn_ended: false,
            pending_tool: false,
            stuck: None,
            hook: None,
        }
    }

    fn hook(
        provider: &str,
        kind: &str,
        id: Option<&str>,
        cwd: Option<&str>,
        ts: i64,
    ) -> crate::hooks::HookEvent {
        crate::hooks::HookEvent {
            provider: provider.into(),
            kind: kind.into(),
            session_id: id.map(str::to_string),
            cwd: cwd.map(str::to_string),
            message: None,
            ts,
        }
    }

    #[test]
    fn hook_events_attach_by_id_then_by_folder() {
        let mut sessions = vec![session("a", "/p", 1_000), session("b", "/q", 1_000)];
        attach_hook_events(
            "claude-code",
            &mut sessions,
            &[
                hook("claude-code", "needs-you", Some("a"), Some("/p"), 1_200),
                hook("codex", "finished", None, Some("/q"), 1_300), // other provider: ignored
            ],
        );
        assert_eq!(sessions[0].hook.as_ref().unwrap().kind, "needs-you");
        assert!(sessions[1].hook.is_none());

        // Codex: matched by folder, to the newest session there.
        let mut codex = vec![session("new", "/q", 5_000), session("old", "/q", 1_000)];
        attach_hook_events(
            "codex",
            &mut codex,
            &[hook(
                "codex",
                "finished",
                Some("thread-x"),
                Some("/q"),
                5_100,
            )],
        );
        assert!(codex[0].hook.is_some() && codex[1].hook.is_none());
    }

    #[test]
    fn stale_hook_events_are_ignored() {
        // The agent kept working after the hook fired: the event is old news.
        let mut sessions = vec![session("a", "/p", 60_000)];
        attach_hook_events(
            "claude-code",
            &mut sessions,
            &[hook("claude-code", "finished", Some("a"), None, 10_000)],
        );
        assert!(sessions[0].hook.is_none());
    }
}
