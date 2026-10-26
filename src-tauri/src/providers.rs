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
    pub reset_at: Option<i64>,
    pub unit: String,
    pub window: String,
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
    let mut used: i64 = 0;
    let window_start = now - layout.window_ms();

    for (path, modified) in files {
        let Some(scan) = scan_session(&path, &layout, window_start) else {
            continue;
        };
        used += scan.weighted;

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
        });
    }

    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
    activities.sort_by_key(|a| std::cmp::Reverse(a.timestamp));
    activities.truncate(MAX_ACTIVITIES);

    let usage = Some(LocalUsageDto {
        used,
        cap: cap.max(1),
        reset_at: Some(next_reset(&layout, now)),
        unit: layout.unit().to_string(),
        window: layout.window().to_string(),
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

/// Where the current usage window ends.
fn next_reset<L: CliLayout>(layout: &L, now: i64) -> i64 {
    match layout.window() {
        // A weekly allowance resets on a boundary, not an arbitrary offset.
        "weekly" => {
            let week = 7 * 86_400_000;
            ((now / week) + 1) * week
        }
        _ => now + layout.window_ms(),
    }
}

struct SessionScan {
    session_id: Option<String>,
    first_ts: Option<i64>,
    last_ts: Option<i64>,
    cwd: Option<String>,
    model: Option<String>,
    weighted: i64,
    event_count: i64,
    steps: Vec<(Step, i64)>,
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
        event_count: 0,
        steps: Vec::new(),
    };

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
        // Only work inside the current window counts against the limit.
        if ts >= window_start {
            scan.weighted += layout.weigh(&record, line);
        }
        if let Some(step) = layout.step(&record) {
            scan.steps.push((step, ts));
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

    #[test]
    fn decodes_a_project_directory_name() {
        let path = Path::new("/home/u/.claude/projects/-Users-dev-code-opspulse/s.jsonl");
        assert_eq!(decode_project_dir(path), "/Users/dev/code/opspulse");
    }
}
