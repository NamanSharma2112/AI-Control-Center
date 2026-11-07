//! Jump to an agent's own terminal.
//!
//! An agent is a process (Claude Code runs on Node or as a native binary,
//! Codex is a native binary) whose working directory is the project. We find
//! that process, walk up its parents to whatever owns a window — Windows
//! Terminal, VS Code, Terminal.app, iTerm — and bring that to the front.
//!
//! Limits, stated plainly: this focuses the terminal's window or app, not the
//! exact tab inside it. When nothing matches (an agent in tmux over SSH, a
//! process we cannot inspect), the caller falls back to opening a new terminal
//! in the project, and says so.

use serde::Serialize;
use std::path::{Path, PathBuf};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// How far up the process tree to look for something with a window.
const MAX_ANCESTORS: usize = 12;

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum FocusOutcome {
    /// The terminal was brought to the front; `app` names it for the toast.
    Focused { app: String },
    /// No running agent process was found for this project.
    NotFound,
}

#[tauri::command]
pub fn focus_agent(provider: String, project_path: String) -> FocusOutcome {
    let Some(chain) = agent_ancestry(&provider, Path::new(&project_path)) else {
        return FocusOutcome::NotFound;
    };
    match platform::focus(&chain) {
        Some(app) => FocusOutcome::Focused { app },
        None => FocusOutcome::NotFound,
    }
}

/// One process in the chain from the agent up towards the terminal.
// Each platform's focuser reads a different subset: Windows uses the ids,
// names and console children; macOS uses only the executable path; the Linux
// stub reads none. Collecting all of them keeps one shared walk.
#[allow(dead_code)]
pub struct Link {
    pub pid: u32,
    pub name: String,
    pub exe: Option<PathBuf>,
    /// Child processes that may own the console window on Windows
    /// (conhost / OpenConsole are children of the shell, not parents).
    pub console_children: Vec<u32>,
}

/// Finds the newest agent process working in `project` and returns it with
/// its ancestors, nearest first.
fn agent_ancestry(provider: &str, project: &Path) -> Option<Vec<Link>> {
    let mut system = System::new().ok()?;
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cwd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    let processes = system.processes();

    let agent = processes
        .values()
        .filter(|p| is_agent(provider, &p.name().to_string_lossy(), p.cmd()))
        .filter(|p| p.cwd().is_some_and(|cwd| same_path(cwd, project)))
        .max_by_key(|p| p.start_time())?;

    let mut chain = Vec::new();
    let mut current: Option<Pid> = Some(agent.pid());
    while let Some(pid) = current {
        if chain.len() >= MAX_ANCESTORS {
            break;
        }
        let Some(p) = processes.get(&pid) else { break };
        let console_children = processes
            .values()
            .filter(|c| c.parent() == Some(pid))
            .filter(|c| {
                let n = c.name().to_string_lossy().to_ascii_lowercase();
                n.starts_with("conhost") || n.starts_with("openconsole")
            })
            .map(|c| c.pid().as_u32())
            .collect();
        chain.push(Link {
            pid: pid.as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            exe: p.exe().map(Path::to_path_buf),
            console_children,
        });
        current = p.parent();
    }
    Some(chain)
}

/// Whether a process is the given provider's agent. Claude Code may run as a
/// native `claude` binary or as Node running the `@anthropic-ai/claude-code`
/// script; Codex is a native binary, possibly wrapped by Node.
fn is_agent(provider: &str, name: &str, cmd: &[std::ffi::OsString]) -> bool {
    let name = name.to_ascii_lowercase();
    let cmd = cmd
        .iter()
        .map(|a| a.to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    match provider {
        "claude-code" => {
            name.starts_with("claude") || cmd.contains("claude-code") || cmd.contains("/claude ")
        }
        "codex" => name.starts_with("codex") || cmd.contains("@openai/codex"),
        _ => false,
    }
}

/// Path equality that tolerates trailing separators, and case on Windows.
fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p.to_string_lossy().replace('\\', "/");
        let s = s.trim_end_matches('/').to_string();
        if cfg!(windows) {
            s.to_ascii_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

#[cfg(windows)]
mod platform {
    use super::Link;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    struct Search {
        pid: u32,
        found: HWND,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> i32 {
        let search = &mut *(lparam as *mut Search);
        let mut owner = 0u32;
        GetWindowThreadProcessId(hwnd, &mut owner);
        // A visible, titled top-level window: the terminal itself, not one
        // of the hidden helper windows every process owns.
        if owner == search.pid && IsWindowVisible(hwnd) != 0 && GetWindowTextLengthW(hwnd) > 0 {
            search.found = hwnd;
            return 0; // stop
        }
        1
    }

    fn window_of(pid: u32) -> Option<HWND> {
        let mut search = Search {
            pid,
            found: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(Some(visit), &mut search as *mut Search as LPARAM);
        }
        (!search.found.is_null()).then_some(search.found)
    }

    /// Focuses the nearest process in the chain that owns a real window.
    pub fn focus(chain: &[Link]) -> Option<String> {
        for link in chain {
            let candidates = std::iter::once(link.pid).chain(link.console_children.iter().copied());
            for pid in candidates {
                if let Some(hwnd) = window_of(pid) {
                    unsafe {
                        if IsIconic(hwnd) != 0 {
                            ShowWindow(hwnd, SW_RESTORE);
                        }
                        SetForegroundWindow(hwnd);
                    }
                    return Some(friendly_name(&link.name));
                }
            }
        }
        None
    }

    fn friendly_name(process: &str) -> String {
        let lower = process.to_ascii_lowercase();
        if lower.starts_with("windowsterminal") {
            "Windows Terminal".into()
        } else if lower.starts_with("code") {
            "VS Code".into()
        } else if lower.starts_with("cursor") {
            "Cursor".into()
        } else if lower.starts_with("pwsh") || lower.starts_with("powershell") {
            "PowerShell".into()
        } else if lower.starts_with("cmd")
            || lower.starts_with("conhost")
            || lower.starts_with("openconsole")
        {
            "the terminal".into()
        } else {
            process.trim_end_matches(".exe").to_string()
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Link;
    use std::process::Command;

    /// Activates the app bundle that the nearest ancestor belongs to. Uses
    /// `open -a`, which needs no Accessibility permission.
    pub fn focus(chain: &[Link]) -> Option<String> {
        for link in chain {
            let Some(exe) = &link.exe else { continue };
            let exe = exe.to_string_lossy();
            let Some(end) = exe.find(".app/Contents/MacOS/") else {
                continue;
            };
            let bundle = &exe[..end + 4];
            let ok = Command::new("open")
                .arg("-a")
                .arg(bundle)
                .status()
                .is_ok_and(|s| s.success());
            if ok {
                let name = bundle
                    .rsplit('/')
                    .next()
                    .unwrap_or("the terminal")
                    .trim_end_matches(".app");
                return Some(name.to_string());
            }
        }
        None
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::Link;

    /// Linux is a development platform here; window focusing is not attempted.
    pub fn focus(_chain: &[Link]) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn recognises_agent_processes() {
        let cmd = |s: &str| s.split(' ').map(OsString::from).collect::<Vec<_>>();
        assert!(is_agent("claude-code", "claude", &cmd("claude")));
        assert!(is_agent(
            "claude-code",
            "node",
            &cmd("node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js")
        ));
        assert!(is_agent("codex", "codex.exe", &cmd("codex.exe")));
        assert!(!is_agent("codex", "node", &cmd("node server.js")));
        assert!(!is_agent("claude-code", "bash", &cmd("bash -l")));
    }

    #[test]
    fn compares_paths_loosely() {
        assert!(same_path(Path::new("/a/b/"), Path::new("/a/b")));
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/bc")));
    }
}
