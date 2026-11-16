//! The browser bridge: how ChatGPT, Claude and Gemini in the browser reach
//! the app.
//!
//! The companion browser extension watches those three sites for two things
//! only: whether the site is writing a reply right now, and whether it is
//! showing its "you've reached your limit" notice. It never reads what you
//! wrote or what the model answered. It sends those signals here, to a small
//! HTTP endpoint that listens on 127.0.0.1 and nowhere else, so nothing ever
//! leaves this computer.
//!
//! Who may talk to it:
//! - Only the extension. Web pages are turned away by their `Origin`, and a
//!   `Host` other than this machine's loopback address (DNS rebinding) is
//!   refused outright.
//! - Only once you have said so. The extension asks to pair, the app shows
//!   the request, and only your "Allow" hands it a token. The token lives in
//!   the OS keychain, and every later call must carry it.

use std::collections::{HashMap, VecDeque};
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::providers::{
    now_ms, HookStateDto, LocalActivityDto, LocalProviderStateDto, LocalSessionDto,
    LocalStepDto, LocalUsageDto,
};
use crate::secrets;

/// The ports the bridge tries, in order. The extension probes the same list.
pub const PORTS: [u16; 4] = [47821, 47822, 47823, 47824];
const KEYCHAIN_ACCOUNT: &str = "browser-bridge";
const MAX_BODY: usize = 16 * 1024;
const PAIR_TTL_MS: i64 = 2 * 60_000;
const MAX_PENDING: usize = 3;
/// A tab that has not said anything for this long is gone (it heartbeats
/// every minute while open).
const TAB_GONE_MS: i64 = 3 * 60_000;
/// A tab that stops sending while "writing" has crashed or been suspended.
const GENERATING_STALE_MS: i64 = 60_000;
const KEEP_PROMPTS_MS: i64 = 8 * 24 * 3_600_000;
const MAX_ACTIVITIES: usize = 40;
const MAX_REPLIES_PER_TAB: usize = 8;

/// The sites the extension knows, by the provider id the app uses for them.
pub const SITES: [&str; 3] = ["chatgpt", "claude-web", "gemini"];

pub fn is_browser_provider(provider: &str) -> bool {
    SITES.contains(&provider)
}

struct SiteInfo {
    name: &'static str,
    /// The usage window the site's limits roughly follow. Estimates: the
    /// sites publish no figures, so the cap is the user's own (Settings).
    window: &'static str,
    window_ms: i64,
}

fn site_info(site: &str) -> SiteInfo {
    match site {
        "chatgpt" => SiteInfo { name: "ChatGPT", window: "session", window_ms: 3 * 3_600_000 },
        "claude-web" => SiteInfo { name: "Claude", window: "session", window_ms: 5 * 3_600_000 },
        _ => SiteInfo { name: "Gemini", window: "daily", window_ms: 24 * 3_600_000 },
    }
}

#[derive(Default)]
struct Tab {
    opened_at: i64,
    last_seen: i64,
    generating_since: Option<i64>,
    /// Finished replies: (started, took ms), newest last.
    replies: VecDeque<(i64, i64)>,
}

#[derive(Default)]
struct SiteState {
    tabs: HashMap<i64, Tab>,
    /// When each reply started: the count of messages sent.
    prompts: VecDeque<i64>,
    last_seen: Option<i64>,
    /// The site said its limit was reached, and when it resets (if it said).
    limited_at: Option<i64>,
    limit_resets_at: Option<i64>,
    activities: VecDeque<LocalActivityDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub id: String,
    pub browser: String,
    pub created_at: i64,
    #[serde(skip)]
    approved: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteStatus {
    pub site: String,
    pub name: String,
    pub last_seen: Option<i64>,
    pub open_tabs: usize,
    pub writing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// The port the bridge listens on, or None if it could not start.
    pub port: Option<u16>,
    /// Whether a browser has been allowed to connect.
    pub paired: bool,
    pub sites: Vec<SiteStatus>,
    pub pending: Vec<PairRequest>,
}

pub struct Bridge {
    token: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
    pending: Mutex<Vec<PairRequest>>,
    sites: Mutex<HashMap<String, SiteState>>,
}

/// What a request asks the app to do besides answering it.
#[derive(Debug, PartialEq)]
pub enum Effect {
    None,
    /// Browser activity changed: re-read and redraw.
    Changed,
    /// A browser asked to pair: show the request.
    PairRequested,
}

pub struct Reply {
    pub status: u16,
    pub body: serde_json::Value,
    pub effect: Effect,
}

impl Reply {
    fn new(status: u16, body: serde_json::Value) -> Self {
        Self { status, body, effect: Effect::None }
    }
    fn error(status: u16, message: &str) -> Self {
        Self::new(status, serde_json::json!({ "error": message }))
    }
    fn with(mut self, effect: Effect) -> Self {
        self.effect = effect;
        self
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventIn {
    site: String,
    tab: i64,
    kind: String,
    /// For "limit": when the site said the limit resets, epoch ms.
    reset_at: Option<i64>,
}

#[derive(Deserialize)]
struct PairIn {
    browser: Option<String>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            token: Mutex::new(secrets::read(KEYCHAIN_ACCOUNT)),
            port: Mutex::new(None),
            pending: Mutex::new(Vec::new()),
            sites: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn with_token(token: Option<&str>) -> Self {
        Self {
            token: Mutex::new(token.map(str::to_string)),
            port: Mutex::new(None),
            pending: Mutex::new(Vec::new()),
            sites: Mutex::new(HashMap::new()),
        }
    }

    fn authorized(&self, header: Option<&str>) -> bool {
        let token = self.token.lock().unwrap();
        match (token.as_deref(), header.and_then(|h| h.strip_prefix("Bearer "))) {
            (Some(expected), Some(given)) => constant_time_eq(expected.as_bytes(), given.as_bytes()),
            _ => false,
        }
    }

    /// Handles one request. `origin` and `host` are the request's headers,
    /// already checked by [`allowed_origin`] and [`allowed_host`].
    pub fn route(
        &self,
        method: &str,
        path: &str,
        auth: Option<&str>,
        body: &[u8],
        now: i64,
    ) -> Reply {
        match (method, path) {
            ("GET", "/v1/hello") => {
                if !self.authorized(auth) {
                    return Reply::error(401, "not paired");
                }
                Reply::new(200, serde_json::json!({
                    "app": "AI Control Center",
                    "version": env!("CARGO_PKG_VERSION"),
                }))
            }
            ("POST", "/v1/pair") => {
                let browser = serde_json::from_slice::<PairIn>(body)
                    .ok()
                    .and_then(|p| p.browser)
                    .map(|b| b.chars().filter(|c| !c.is_control()).take(40).collect::<String>())
                    .filter(|b| !b.trim().is_empty())
                    .unwrap_or_else(|| "A browser".to_string());
                let mut pending = self.pending.lock().unwrap();
                pending.retain(|p| now - p.created_at < PAIR_TTL_MS);
                if pending.iter().filter(|p| p.approved.is_none()).count() >= MAX_PENDING {
                    return Reply::error(429, "too many requests waiting");
                }
                let request = PairRequest { id: random_hex(12), browser, created_at: now, approved: None };
                let id = request.id.clone();
                pending.push(request);
                Reply::new(202, serde_json::json!({ "id": id })).with(Effect::PairRequested)
            }
            ("GET", p) if p.starts_with("/v1/pair/") => {
                let id = &p["/v1/pair/".len()..];
                let mut pending = self.pending.lock().unwrap();
                pending.retain(|p| now - p.created_at < PAIR_TTL_MS);
                let Some(index) = pending.iter().position(|r| r.id == id) else {
                    return Reply::new(200, serde_json::json!({ "status": "expired" }));
                };
                match pending[index].approved {
                    None => Reply::new(200, serde_json::json!({ "status": "pending" })),
                    Some(false) => {
                        pending.remove(index);
                        Reply::new(200, serde_json::json!({ "status": "denied" }))
                    }
                    Some(true) => {
                        // The token is handed over once, then the request is gone.
                        pending.remove(index);
                        let token = self.token.lock().unwrap().clone();
                        match token {
                            Some(token) => Reply::new(200, serde_json::json!({ "status": "approved", "token": token })),
                            None => Reply::new(200, serde_json::json!({ "status": "denied" })),
                        }
                    }
                }
            }
            ("POST", "/v1/events") => {
                if !self.authorized(auth) {
                    return Reply::error(401, "not paired");
                }
                let events: Vec<EventIn> = match serde_json::from_slice::<serde_json::Value>(body) {
                    Ok(serde_json::Value::Array(items)) => items
                        .into_iter()
                        .take(50)
                        .filter_map(|v| serde_json::from_value(v).ok())
                        .collect(),
                    Ok(single) => serde_json::from_value(single).into_iter().collect(),
                    Err(_) => return Reply::error(400, "bad json"),
                };
                let mut changed = false;
                for event in events {
                    changed |= self.apply(event, now);
                }
                let reply = Reply::new(200, serde_json::json!({ "ok": true }));
                if changed { reply.with(Effect::Changed) } else { reply }
            }
            _ => Reply::error(404, "not found"),
        }
    }

    /// Records one event. Returns whether anything the user can see changed.
    fn apply(&self, event: EventIn, now: i64) -> bool {
        if !is_browser_provider(&event.site) {
            return false;
        }
        let mut sites = self.sites.lock().unwrap();
        let site = sites.entry(event.site.clone()).or_default();
        site.last_seen = Some(now);
        let name = site_info(&event.site).name;

        if event.kind == "closed" {
            let had = site.tabs.remove(&event.tab).is_some();
            return had;
        }
        let tab = site.tabs.entry(event.tab).or_insert_with(|| Tab {
            opened_at: now,
            ..Tab::default()
        });
        tab.last_seen = now;

        match event.kind.as_str() {
            "generating" => {
                if tab.generating_since.is_some() {
                    return false; // a heartbeat while writing
                }
                tab.generating_since = Some(now);
                site.prompts.push_back(now);
                // Writing again means the limit, if there was one, has lifted.
                site.limited_at = None;
                site.limit_resets_at = None;
                true
            }
            "idle" => {
                let Some(started) = tab.generating_since.take() else {
                    return false;
                };
                let took = (now - started).max(0);
                tab.replies.push_back((started, took));
                while tab.replies.len() > MAX_REPLIES_PER_TAB {
                    tab.replies.pop_front();
                }
                push_activity(site, &event.site, event.tab, "task-completed",
                    format!("{name} finished a reply ({})", short_duration(took)), now);
                true
            }
            "limit" => {
                let reset = event
                    .reset_at
                    .filter(|t| *t > now && *t < now + 8 * 24 * 3_600_000);
                let fresh = site.limited_at.is_none() || site.limit_resets_at != reset;
                site.limited_at = Some(now);
                site.limit_resets_at = reset;
                if fresh {
                    push_activity(site, &event.site, event.tab, "usage-threshold",
                        format!("{name} says its usage limit is reached"), now);
                }
                fresh
            }
            // "present": the tab is open; nothing else to record.
            _ => false,
        }
    }

    fn prune(&self, now: i64) {
        let mut sites = self.sites.lock().unwrap();
        for site in sites.values_mut() {
            site.tabs.retain(|_, t| now - t.last_seen < TAB_GONE_MS);
            for tab in site.tabs.values_mut() {
                if let Some(started) = tab.generating_since {
                    if now - tab.last_seen > GENERATING_STALE_MS {
                        tab.generating_since = None;
                        tab.replies.push_back((started, (tab.last_seen - started).max(0)));
                    }
                }
            }
            while site.prompts.front().is_some_and(|t| now - *t > KEEP_PROMPTS_MS) {
                site.prompts.pop_front();
            }
            if site.limit_resets_at.is_some_and(|t| t <= now) {
                site.limited_at = None;
                site.limit_resets_at = None;
            }
        }
    }

    /// The site's activity, in the same shape the CLI readers produce.
    pub fn provider_state(&self, site: &str, cap: i64) -> LocalProviderStateDto {
        let now = now_ms();
        self.prune(now);
        let info = site_info(site);
        let sites = self.sites.lock().unwrap();
        let Some(state) = sites.get(site) else {
            return LocalProviderStateDto {
                available: false,
                detail: Some(format!(
                    "{} isn't connected. Add the AI Control Center extension to your browser.",
                    info.name
                )),
                sessions: Vec::new(),
                activities: Vec::new(),
                usage: None,
            };
        };

        let mut sessions: Vec<LocalSessionDto> = state
            .tabs
            .iter()
            // A tab where nothing has been asked yet is not a session.
            .filter(|(_, t)| t.generating_since.is_some() || !t.replies.is_empty())
            .map(|(tab_id, tab)| tab_session(site, &info, *tab_id, tab, state.limited_at.is_some()))
            .collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));

        let in_window: Vec<i64> = state
            .prompts
            .iter()
            .copied()
            .filter(|t| now - *t < info.window_ms)
            .collect();
        let local_reset = in_window.first().map(|t| t + info.window_ms);
        let usage = if state.limited_at.is_some() {
            LocalUsageDto {
                used: in_window.len() as i64,
                cap,
                reset_at: state.limit_resets_at.or(local_reset),
                unit: "messages".to_string(),
                window: info.window.to_string(),
                used_percent: Some(100.0),
                // The site itself said the limit is reached.
                source: "provider".to_string(),
            }
        } else {
            LocalUsageDto {
                used: in_window.len() as i64,
                cap,
                reset_at: local_reset,
                unit: "messages".to_string(),
                window: info.window.to_string(),
                used_percent: None,
                source: "local".to_string(),
            }
        };

        LocalProviderStateDto {
            available: true,
            detail: None,
            sessions,
            activities: state.activities.iter().cloned().collect(),
            usage: Some(usage),
        }
    }

    pub fn status(&self) -> BridgeStatus {
        self.status_at(now_ms())
    }

    fn status_at(&self, now: i64) -> BridgeStatus {
        self.prune(now);
        let sites = self.sites.lock().unwrap();
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|p| now - p.created_at < PAIR_TTL_MS);
        BridgeStatus {
            port: *self.port.lock().unwrap(),
            paired: self.token.lock().unwrap().is_some(),
            sites: SITES
                .iter()
                .map(|site| {
                    let state = sites.get(*site);
                    SiteStatus {
                        site: site.to_string(),
                        name: site_info(site).name.to_string(),
                        last_seen: state.and_then(|s| s.last_seen),
                        open_tabs: state.map_or(0, |s| s.tabs.len()),
                        writing: state.is_some_and(|s| s.tabs.values().any(|t| t.generating_since.is_some())),
                    }
                })
                .collect(),
            pending: pending.iter().filter(|p| p.approved.is_none()).cloned().collect(),
        }
    }

    pub fn port(&self) -> Option<u16> {
        *self.port.lock().unwrap()
    }

    /// Your answer to a pairing request.
    pub fn respond(&self, id: &str, allow: bool) -> Result<(), String> {
        if allow {
            let mut token = self.token.lock().unwrap();
            if token.is_none() {
                let fresh = random_hex(24);
                // The keychain keeps it across restarts. Where there is no
                // keychain the pairing lasts until the app quits.
                let _ = secrets::store(KEYCHAIN_ACCOUNT, &fresh);
                *token = Some(fresh);
            }
        }
        let mut pending = self.pending.lock().unwrap();
        let request = pending
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or("That request has expired. Ask again from the extension.")?;
        request.approved = Some(allow);
        Ok(())
    }

    /// Disconnects every browser: the token is destroyed, so the extension
    /// has to ask again.
    pub fn forget(&self) -> Result<(), String> {
        *self.token.lock().unwrap() = None;
        self.sites.lock().unwrap().clear();
        secrets::delete(KEYCHAIN_ACCOUNT)
    }
}

fn tab_session(site: &str, info: &SiteInfo, tab_id: i64, tab: &Tab, limited: bool) -> LocalSessionDto {
    let mut steps: Vec<LocalStepDto> = tab
        .replies
        .iter()
        .map(|(start, took)| LocalStepDto {
            id: format!("{site}-{tab_id}-{start}"),
            kind: "reply".to_string(),
            label: format!("Wrote a reply in {}", short_duration(*took)),
            started_at: *start,
            duration_ms: Some(*took),
        })
        .collect();
    if let Some(start) = tab.generating_since {
        steps.push(LocalStepDto {
            id: format!("{site}-{tab_id}-{start}"),
            kind: "reply".to_string(),
            label: "Writing a reply".to_string(),
            started_at: start,
            duration_ms: None,
        });
    }
    let last_end = tab.replies.back().map(|(s, t)| s + t);
    let writing = tab.generating_since.is_some();
    LocalSessionDto {
        id: format!("{site}-tab-{tab_id}"),
        project: format!("{} in your browser", info.name),
        project_path: String::new(),
        status: String::new(),
        started_at: tab.opened_at,
        last_activity_at: if writing { tab.last_seen } else { last_end.unwrap_or(tab.opened_at) },
        current_activity: if writing {
            "Writing a reply".to_string()
        } else if limited {
            "Usage limit reached".to_string()
        } else {
            "Reply finished".to_string()
        },
        event_count: tab.replies.len() as i64 + i64::from(writing),
        model: None,
        steps,
        files_changed: 0,
        turn_ended: !writing,
        pending_tool: false,
        stuck: None,
        // The extension saw the reply end: that is as exact as a CLI hook.
        hook: (!writing).then(|| HookStateDto {
            kind: "finished".to_string(),
            message: None,
            at: last_end.unwrap_or(tab.opened_at),
        }),
    }
}

fn push_activity(site: &mut SiteState, site_id: &str, tab: i64, kind: &str, message: String, now: i64) {
    site.activities.push_front(LocalActivityDto {
        id: format!("{site_id}-{tab}-{now}-{kind}"),
        session_id: Some(format!("{site_id}-tab-{tab}")),
        project: Some(format!("{} in your browser", site_info(site_id).name)),
        kind: kind.to_string(),
        message,
        timestamp: now,
    });
    site.activities.truncate(MAX_ACTIVITIES);
}

fn short_duration(ms: i64) -> String {
    let s = ms / 1000;
    if s < 60 { format!("{s}s") } else { format!("{}m {}s", s / 60, s % 60) }
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("the OS random source is available");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Requests from a web page carry its `Origin`; only extensions may call.
/// No `Origin` at all is a non-browser client on this machine, which could
/// read the keychain anyway.
pub fn allowed_origin(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => ["chrome-extension://", "moz-extension://", "safari-web-extension://"]
            .iter()
            .any(|p| o.starts_with(p)),
    }
}

/// Only this machine's loopback names, so a hostile site cannot reach the
/// bridge through DNS rebinding.
pub fn allowed_host(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"))
}

/// Starts the bridge on the first free port, on a thread of its own.
pub fn start(app: AppHandle, bridge: Arc<Bridge>) {
    serve(bridge, move |effect| match effect {
        Effect::Changed => {
            let _ = app.emit("provider://changed", ());
        }
        Effect::PairRequested => {
            let _ = app.emit("bridge://pair-request", ());
        }
        Effect::None => {}
    });
}

/// The HTTP side, apart from the app, so it can run on its own in tests.
#[doc(hidden)]
pub fn serve(bridge: Arc<Bridge>, on_effect: impl Fn(Effect) + Send + 'static) {
    thread::spawn(move || {
        let Some((server, port)) = PORTS
            .iter()
            .find_map(|p| Server::http(("127.0.0.1", *p)).ok().map(|s| (s, *p)))
        else {
            return;
        };
        *bridge.port.lock().unwrap() = Some(port);
        for mut request in server.incoming_requests() {
            let header = |name: &'static str| {
                request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv(name))
                    .map(|h| h.value.as_str().to_string())
            };
            let origin = header("Origin");
            let host = header("Host");
            let auth = header("Authorization");

            let cors = origin.clone().filter(|o| allowed_origin(Some(o)));
            let respond = |request: tiny_http::Request, status: u16, body: &serde_json::Value| {
                let mut response = Response::new(
                    StatusCode(status),
                    vec![Header::from_bytes("Content-Type", "application/json").unwrap()],
                    Cursor::new(body.to_string().into_bytes()),
                    None,
                    None,
                );
                if let Some(o) = &cors {
                    response.add_header(Header::from_bytes("Access-Control-Allow-Origin", o.as_bytes()).unwrap());
                    response.add_header(Header::from_bytes("Access-Control-Allow-Headers", "authorization, content-type").unwrap());
                    response.add_header(Header::from_bytes("Access-Control-Allow-Methods", "GET, POST").unwrap());
                }
                let _ = request.respond(response);
            };

            if !allowed_host(host.as_deref(), port) || !allowed_origin(origin.as_deref()) {
                respond(request, 403, &serde_json::json!({ "error": "forbidden" }));
                continue;
            }
            if *request.method() == Method::Options {
                respond(request, 204, &serde_json::Value::Null);
                continue;
            }
            let mut body = Vec::new();
            if request.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut body).is_err()
                || body.len() > MAX_BODY
            {
                respond(request, 413, &serde_json::json!({ "error": "too large" }));
                continue;
            }
            let method = request.method().as_str().to_string();
            let path = request.url().split('?').next().unwrap_or("").to_string();
            let reply = bridge.route(&method, &path, auth.as_deref(), &body, now_ms());
            respond(request, reply.status, &reply.body);
            on_effect(reply.effect);
        }
    });
}

/// Copies the extension that ships inside the app to a folder you can find
/// (Documents › AI Control Center › browser-extension) and shows it, ready
/// for the browser's "Load unpacked". A fresh copy each time keeps it in step
/// with the app's version.
#[tauri::command]
pub fn install_browser_extension(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let source = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("browser-extension");
    if !source.join("manifest.json").exists() {
        return Err("The extension is missing from this copy of the app.".to_string());
    }
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or("Could not find your Documents folder.")?;
    let target = base.join("AI Control Center").join("browser-extension");
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    copy_dir(&source, &target).map_err(|e| e.to_string())?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(target.join("manifest.json"));
    Ok(target.display().to_string())
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn bridge_status(bridge: tauri::State<'_, Arc<Bridge>>) -> BridgeStatus {
    bridge.status()
}

#[tauri::command]
pub fn bridge_respond(
    app: AppHandle,
    id: String,
    allow: bool,
    bridge: tauri::State<'_, Arc<Bridge>>,
) -> Result<(), String> {
    bridge.respond(&id, allow)?;
    let _ = app.emit("bridge://changed", ());
    Ok(())
}

#[tauri::command]
pub fn bridge_forget(app: AppHandle, bridge: tauri::State<'_, Arc<Bridge>>) -> Result<(), String> {
    bridge.forget()?;
    let _ = app.emit("provider://changed", ());
    let _ = app.emit("bridge://changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_700_000_000_000;

    fn event(bridge: &Bridge, body: &str, at: i64) -> Reply {
        bridge.route("POST", "/v1/events", Some("Bearer tok"), body.as_bytes(), at)
    }

    #[test]
    fn web_pages_and_rebinding_are_refused() {
        assert!(allowed_origin(None));
        assert!(allowed_origin(Some("chrome-extension://abcdef")));
        assert!(allowed_origin(Some("moz-extension://abcdef")));
        assert!(!allowed_origin(Some("https://evil.example")));
        assert!(!allowed_origin(Some("null")));
        assert!(allowed_host(Some("127.0.0.1:47821"), 47821));
        assert!(allowed_host(Some("localhost:47821"), 47821));
        assert!(!allowed_host(Some("evil.example:47821"), 47821));
        assert!(!allowed_host(None, 47821));
    }

    #[test]
    fn events_need_the_token() {
        let bridge = Bridge::with_token(Some("tok"));
        let body = br#"{"site":"chatgpt","tab":1,"kind":"generating"}"#;
        assert_eq!(bridge.route("POST", "/v1/events", None, body, T).status, 401);
        assert_eq!(bridge.route("POST", "/v1/events", Some("Bearer nope"), body, T).status, 401);
        assert_eq!(bridge.route("POST", "/v1/events", Some("Bearer tok"), body, T).status, 200);
        let unpaired = Bridge::with_token(None);
        assert_eq!(unpaired.route("GET", "/v1/hello", Some("Bearer tok"), b"", T).status, 401);
    }

    #[test]
    fn pairing_hands_over_the_token_once_after_you_allow_it() {
        let bridge = Bridge::with_token(Some("tok"));
        let reply = bridge.route("POST", "/v1/pair", None, br#"{"browser":"Chrome"}"#, T);
        assert_eq!(reply.status, 202);
        assert_eq!(reply.effect, Effect::PairRequested);
        let id = reply.body["id"].as_str().unwrap().to_string();
        let path = format!("/v1/pair/{id}");

        assert_eq!(bridge.route("GET", &path, None, b"", T).body["status"], "pending");
        assert_eq!(bridge.status_at(T).pending.len(), 1);
        assert_eq!(bridge.status_at(T).pending[0].browser, "Chrome");

        bridge.respond(&id, true).unwrap();
        let approved = bridge.route("GET", &path, None, b"", T + 1);
        assert_eq!(approved.body["status"], "approved");
        assert_eq!(approved.body["token"], "tok");
        // Gone after the first read.
        assert_eq!(bridge.route("GET", &path, None, b"", T + 2).body["status"], "expired");
    }

    #[test]
    fn pairing_can_be_denied_and_expires() {
        let bridge = Bridge::with_token(Some("tok"));
        let id = bridge.route("POST", "/v1/pair", None, b"{}", T).body["id"].as_str().unwrap().to_string();
        bridge.respond(&id, false).unwrap();
        let denied = bridge.route("GET", &format!("/v1/pair/{id}"), None, b"", T);
        assert_eq!(denied.body["status"], "denied");
        assert!(denied.body.get("token").is_none());

        let id = bridge.route("POST", "/v1/pair", None, b"{}", T).body["id"].as_str().unwrap().to_string();
        let late = bridge.route("GET", &format!("/v1/pair/{id}"), None, b"", T + PAIR_TTL_MS + 1);
        assert_eq!(late.body["status"], "expired");
    }

    #[test]
    fn pair_requests_are_capped() {
        let bridge = Bridge::with_token(None);
        for _ in 0..MAX_PENDING {
            assert_eq!(bridge.route("POST", "/v1/pair", None, b"{}", T).status, 202);
        }
        assert_eq!(bridge.route("POST", "/v1/pair", None, b"{}", T).status, 429);
    }

    #[test]
    fn a_reply_is_counted_and_shown_as_a_session() {
        let bridge = Bridge::with_token(Some("tok"));
        assert_eq!(event(&bridge, r#"{"site":"chatgpt","tab":7,"kind":"present"}"#, T).effect, Effect::None);
        assert_eq!(event(&bridge, r#"{"site":"chatgpt","tab":7,"kind":"generating"}"#, T + 1_000).effect, Effect::Changed);
        // A heartbeat while writing changes nothing visible.
        assert_eq!(event(&bridge, r#"{"site":"chatgpt","tab":7,"kind":"generating"}"#, T + 5_000).effect, Effect::None);

        {
            let sites = bridge.sites.lock().unwrap();
            let tab = &sites["chatgpt"].tabs[&7];
            assert_eq!(tab.generating_since, Some(T + 1_000));
        }
        assert_eq!(event(&bridge, r#"{"site":"chatgpt","tab":7,"kind":"idle"}"#, T + 13_000).effect, Effect::Changed);

        let sites = bridge.sites.lock().unwrap();
        let site = &sites["chatgpt"];
        assert_eq!(site.prompts.len(), 1);
        assert_eq!(site.tabs[&7].replies[0], (T + 1_000, 12_000));
        assert_eq!(site.activities[0].message, "ChatGPT finished a reply (12s)");
        let session = tab_session("chatgpt", &site_info("chatgpt"), 7, &site.tabs[&7], false);
        assert_eq!(session.project, "ChatGPT in your browser");
        assert_eq!(session.hook.as_ref().unwrap().kind, "finished");
        assert_eq!(session.steps.len(), 1);
    }

    #[test]
    fn limit_notice_and_its_reset() {
        let bridge = Bridge::with_token(Some("tok"));
        let reset = T + 3_600_000;
        let body = format!(r#"{{"site":"claude-web","tab":2,"kind":"limit","resetAt":{reset}}}"#);
        assert_eq!(event(&bridge, &body, T).effect, Effect::Changed);
        // The same notice again is not news.
        assert_eq!(event(&bridge, &body, T + 1_000).effect, Effect::None);
        {
            let sites = bridge.sites.lock().unwrap();
            assert_eq!(sites["claude-web"].limit_resets_at, Some(reset));
        }
        // A reset time in the past or absurdly far away is ignored.
        let bad = format!(r#"{{"site":"gemini","tab":3,"kind":"limit","resetAt":{}}}"#, T - 1);
        event(&bridge, &bad, T);
        assert_eq!(bridge.sites.lock().unwrap()["gemini"].limit_resets_at, None);
        // Writing again lifts it.
        event(&bridge, r#"{"site":"claude-web","tab":2,"kind":"generating"}"#, T + 2_000);
        assert_eq!(bridge.sites.lock().unwrap()["claude-web"].limited_at, None);
    }

    #[test]
    fn unknown_sites_and_bad_bodies_are_ignored() {
        let bridge = Bridge::with_token(Some("tok"));
        assert_eq!(event(&bridge, r#"{"site":"evil","tab":1,"kind":"generating"}"#, T).effect, Effect::None);
        assert!(bridge.sites.lock().unwrap().is_empty());
        assert_eq!(event(&bridge, "not json", T).status, 400);
        // A batch is accepted.
        let batch = r#"[{"site":"gemini","tab":1,"kind":"generating"},{"site":"gemini","tab":1,"kind":"idle"}]"#;
        assert_eq!(event(&bridge, batch, T).effect, Effect::Changed);
    }

    #[test]
    fn closed_and_silent_tabs_go_away() {
        let bridge = Bridge::with_token(Some("tok"));
        event(&bridge, r#"{"site":"chatgpt","tab":1,"kind":"generating"}"#, T);
        event(&bridge, r#"{"site":"chatgpt","tab":2,"kind":"present"}"#, T);
        assert_eq!(event(&bridge, r#"{"site":"chatgpt","tab":2,"kind":"closed"}"#, T).effect, Effect::Changed);
        // Tab 1 stops sending mid-reply: the reply is closed off, then the tab dropped.
        bridge.prune(T + GENERATING_STALE_MS + 1);
        assert!(bridge.sites.lock().unwrap()["chatgpt"].tabs[&1].generating_since.is_none());
        bridge.prune(T + TAB_GONE_MS + 1);
        assert!(bridge.sites.lock().unwrap()["chatgpt"].tabs.is_empty());
    }
}
