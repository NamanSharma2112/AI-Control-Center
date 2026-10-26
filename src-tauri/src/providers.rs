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

/// One record from a transcript, reduced to what we actually use.
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
    #[serde(default)]
    text: Option<String>,
}

pub fn read_provider_state(provider: &str, cap: i64) -> LocalProviderStateDto {
    match provider {
        "claude-code" => read_cli_state(ClaudeCode, cap),
        "codex" => read_cli_state(Codex, cap),
        other => LocalProviderStateDto::unavailable(&format!("Unknown provider \"{other}\".")),
    }
}

/// What differs between the two CLIs. Adding a third means adding one of
/// these, not touching the scanning logic.
trait CliLayout {
    fn name(&self) -> &'static str;
    /// The CLI's state directory, e.g. `~/.claude`.
    fn root(&self) -> Option<PathBuf>;
    /// Directory holding session transcripts, relative to the root.
    fn sessions_dir(&self, root: &Path) -> PathBuf;
    /// Unit the usage figure is counted in.
    fn unit(&self) -> &'static str;
    /// Which limit window the usage figure belongs to.
    fn window(&self) -> &'static str;
    /// Length of that window, for the reset countdown.
    fn window_ms(&self) -> i64;
    /// How much one record contributes to the usage count.
    fn weigh(&self, record: &Record, raw: &str) -> i64;
    /// Human description of what a record was, for the activity feed.
    fn describe(&self, record: &Record) -> Option<(String, String)>;
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
        // Token counts the CLI already recorded for its own requests. This is
        // a local reading of the user's own transcript, not a provider figure,
        // and the UI labels it as such.
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

    fn describe(&self, record: &Record) -> Option<(String, String)> {
        match record.kind.as_deref() {
            Some("user") => Some(("command-run".into(), "Prompt sent".into())),
            Some("assistant") => {
                let tool = record
                    .message
                    .as_ref()
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                    .and_then(|items| {
                        items.iter().find_map(|i| {
                            (i.get("type")?.as_str()? == "tool_use")
                                .then(|| i.get("name")?.as_str().map(str::to_string))?
                        })
                    });
                match tool.as_deref() {
                    Some("Edit") | Some("Write") | Some("NotebookEdit") => {
                        Some(("file-edited".into(), "Edited files".into()))
                    }
                    Some("Bash") => Some(("command-run".into(), "Ran a command".into())),
                    Some(other) => Some(("command-run".into(), format!("Used {other}"))),
                    None => Some(("task-completed".into(), "Replied".into())),
                }
            }
            _ => None,
        }
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

    fn weigh(&self, record: &Record, raw: &str) -> i64 {
        // Codex does not record token counts in its rollouts, so the honest
        // local measure is "requests made": one per user turn.
        let is_turn = record.kind.as_deref() == Some("user")
            || raw.contains("\"role\":\"user\"")
            || record.text.is_some();
        i64::from(is_turn)
    }

    fn describe(&self, record: &Record) -> Option<(String, String)> {
        match record.kind.as_deref() {
            Some("user") => Some(("command-run".into(), "Prompt sent".into())),
            Some("assistant") | Some("message") => {
                Some(("task-completed".into(), "Replied".into()))
            }
            Some("function_call") | Some("tool_use") => {
                Some(("command-run".into(), "Ran a tool".into()))
            }
            _ => record
                .text
                .as_ref()
                .map(|_| ("command-run".into(), "Prompt sent".into())),
        }
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

        for (i, (kind, message, ts)) in scan.activities.iter().enumerate() {
            activities.push(LocalActivityDto {
                id: format!("{id}-{i}"),
                session_id: Some(id.clone()),
                project: Some(project.clone()),
                kind: kind.clone(),
                message: message.clone(),
                timestamp: *ts,
            });
        }

        let last_activity_at = scan.last_ts.unwrap_or(modified);

        sessions.push(LocalSessionDto {
            id,
            project,
            project_path,
            // The webview decides running-vs-waiting from the timestamp, so
            // the rule lives in one place rather than two.
            status: "active".to_string(),
            started_at: scan.first_ts.unwrap_or(modified),
            last_activity_at,
            current_activity: scan.last_message.unwrap_or_else(|| "Working".to_string()),
            event_count: scan.event_count,
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
    last_message: Option<String>,
    cwd: Option<String>,
    weighted: i64,
    event_count: i64,
    activities: Vec<(String, String, i64)>,
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
        last_message: None,
        cwd: None,
        weighted: 0,
        event_count: 0,
        activities: Vec::new(),
    };

    // Head: one line is enough for the project and the start time.
    {
        let mut head = String::new();
        let mut reader = BufReader::new(&file);
        if reader.read_line(&mut head).ok()? > 0 {
            if let Ok(record) = serde_json::from_str::<Record>(head.trim()) {
                scan.cwd = record.cwd.clone();
                scan.session_id = record.session_id.clone();
                scan.first_ts = parse_ts(&record);
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
            scan.cwd = record.cwd.clone();
        }
        if scan.session_id.is_none() {
            scan.session_id = record.session_id.clone();
        }

        let ts = parse_ts(&record);
        if let Some(ts) = ts {
            scan.last_ts = Some(scan.last_ts.map_or(ts, |prev: i64| prev.max(ts)));
            if scan.first_ts.is_none() {
                scan.first_ts = Some(ts);
            }
            // Only work inside the current window counts against the limit.
            if ts >= window_start {
                scan.weighted += layout.weigh(&record, line);
            }
            if let Some((kind, message)) = layout.describe(&record) {
                scan.last_message = Some(message.clone());
                scan.activities.push((kind, message, ts));
            }
        }
    }

    // Keep only the newest few per session; the feed merges across sessions.
    scan.activities.sort_by_key(|a| std::cmp::Reverse(a.2));
    scan.activities.truncate(12);

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

    #[test]
    fn parses_rfc3339_with_and_without_millis() {
        // 2024-01-01T00:00:00Z is 1704067200000 ms.
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T00:00:00Z"),
            Some(1_704_067_200_000)
        );
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T00:00:00.250Z"),
            Some(1_704_067_200_250)
        );
        // A leap day, to exercise the civil-date maths.
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
        let secs: Record = serde_json::from_str(r#"{"ts": 1704067200}"#).unwrap();
        let ms: Record = serde_json::from_str(r#"{"ts": 1704067200000}"#).unwrap();
        assert_eq!(parse_ts(&secs), Some(1_704_067_200_000));
        assert_eq!(parse_ts(&ms), Some(1_704_067_200_000));
    }

    #[test]
    fn claude_weighs_every_token_bucket() {
        let record: Record = serde_json::from_str(
            r#"{"type":"assistant","message":{"usage":{
                "input_tokens":10,"output_tokens":5,
                "cache_creation_input_tokens":2,"cache_read_input_tokens":3}}}"#,
        )
        .unwrap();
        assert_eq!(ClaudeCode.weigh(&record, ""), 20);
    }

    #[test]
    fn claude_names_the_tool_a_turn_used() {
        let edit: Record = serde_json::from_str(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}"#,
        )
        .unwrap();
        assert_eq!(
            ClaudeCode.describe(&edit),
            Some(("file-edited".into(), "Edited files".into()))
        );

        let bash: Record = serde_json::from_str(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#,
        )
        .unwrap();
        assert_eq!(
            ClaudeCode.describe(&bash),
            Some(("command-run".into(), "Ran a command".into()))
        );
    }

    #[test]
    fn codex_counts_user_turns_only() {
        let turn: Record = serde_json::from_str(r#"{"type":"user"}"#).unwrap();
        let reply: Record = serde_json::from_str(r#"{"type":"assistant"}"#).unwrap();
        assert_eq!(Codex.weigh(&turn, "{\"type\":\"user\"}"), 1);
        assert_eq!(Codex.weigh(&reply, "{\"type\":\"assistant\"}"), 0);
    }

    #[test]
    fn missing_provider_root_is_reported_not_faked() {
        let state = read_provider_state("definitely-not-a-provider", 100);
        assert!(!state.available);
        assert!(state.usage.is_none());
        assert!(state.detail.is_some());
    }

    /// The core guarantee: a transcript on disk becomes a session with the
    /// right project, timestamps and usage, reading head and tail only.
    #[test]
    fn scans_a_claude_transcript_end_to_end() {
        let dir = std::env::temp_dir().join(format!("acc-test-{}", std::process::id()));
        let project_dir = dir.join("-Users-dev-code-motionlib");
        std::fs::create_dir_all(&project_dir).unwrap();
        let path = project_dir.join("abc-123.jsonl");

        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(
            f,
            r#"{{"type":"user","sessionId":"abc-123","cwd":"/Users/dev/code/motionlib","timestamp":"2024-01-01T10:00:00Z"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"assistant","timestamp":"2024-01-01T10:05:00Z","message":{{"usage":{{"input_tokens":100,"output_tokens":50}},"content":[{{"type":"tool_use","name":"Edit"}}]}}}}"#
        )
        .unwrap();
        drop(f);

        // A window starting before the records so both count toward usage.
        let scan = scan_session(&path, &ClaudeCode, 0).expect("scan should succeed");

        assert_eq!(scan.session_id.as_deref(), Some("abc-123"));
        assert_eq!(scan.cwd.as_deref(), Some("/Users/dev/code/motionlib"));
        assert_eq!(scan.first_ts, parse_rfc3339_ms("2024-01-01T10:00:00Z"));
        assert_eq!(scan.last_ts, parse_rfc3339_ms("2024-01-01T10:05:00Z"));
        assert_eq!(scan.weighted, 150);
        assert_eq!(scan.last_message.as_deref(), Some("Edited files"));

        // Records outside the window must not count against the limit.
        let future_window = now_ms() + 86_400_000;
        let scan2 = scan_session(&path, &ClaudeCode, future_window).unwrap();
        assert_eq!(scan2.weighted, 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn decodes_a_project_directory_name() {
        let path = Path::new("/home/u/.claude/projects/-Users-dev-code-opspulse/s.jsonl");
        assert_eq!(decode_project_dir(path), "/Users/dev/code/opspulse");
    }
}
