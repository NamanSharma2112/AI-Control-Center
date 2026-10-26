# AI Control Center

A lightweight desktop utility that answers three questions from anywhere on the
desktop, in about two seconds:

1. **How much AI usage do I have left?**
2. **What are my AI agents doing right now?**
3. **What have my agents been doing recently?**

Push the cursor into the screen edge, or press the shortcut, and a panel slides
in with provider usage, every running agent session, and a feed of what just
happened. Click away and it is gone. It lives in the tray / menu bar and has no
main window.

Windows 11 and macOS. Local-first: no backend, no account, no telemetry.

---

## Running it

```bash
npm install
npm run app:dev      # Tauri dev: Rust shell + Vite webview
npm run app:build    # production bundle for the current platform
```

Frontend-only (useful for UI work; falls back to sample data because a browser
has no local CLI state to read):

```bash
npm run dev
```

Checks:

```bash
npm run typecheck                      # tsc, no emit
cd src-tauri && cargo test && cargo clippy
```

### Platform build prerequisites

- **macOS** — Xcode command line tools.
- **Windows** — the MSVC build tools and WebView2 (present on Windows 11).
- **Linux** (dev only; not a shipping target) — `libwebkit2gtk-4.1-dev`,
  `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.

---

## Where the data comes from

Both supported CLIs keep their own session history on disk, in the user's home
directory, as newline-delimited JSON. The adapters read those files. That is
all they do.

| Provider | Read from |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

**Not done, ever:** scraping a provider's website, reading browser cookies or
storage, bypassing authentication, or sending activity anywhere.

### Provenance

Neither provider publishes a usage API, so usage figures here are counted
locally from the user's own transcripts against a ceiling set in Settings.
Every value carries a `source` and the UI renders it:

| Source | Meaning | Shown as |
|---|---|---|
| `provider` | The provider reported this figure | *(no mark — this is the baseline)* |
| `local` | Counted from local state on this machine | `local` |
| `estimated` | Derived or inferred | `est.` |

A locally derived number is never presented as an official one. If a provider
ships a usage API later, its adapter returns `source: "provider"` and the mark
disappears on its own.

---

## Architecture

```
src/
  types/domain.ts          normalized model the UI consumes
  providers/
    ProviderAdapter.ts     the capability contract
    registry.ts            picks live vs. mock per provider
    mock/                  sample data; makes the UI reviewable offline
    local/                 real adapters over the Rust commands
  store/                   zustand: app view model + settings
  lib/derive.ts            pure derivations (history, projects, day rollup)
  lib/motion.ts            the motion system
  components/              panel, dashboard, settings
  styles/tokens.css        the design tokens, both themes

src-tauri/src/
  providers.rs             bounded local transcript scanning
  window.rs                edge placement, show/hide, summon source
  edge.rs                  adaptive cursor sampling
  shortcut.rs  tray.rs  watcher.rs  db.rs  secrets.rs  commands.rs
```

### Adding a provider

1. Implement `ProviderAdapter` (`getStatus`, `getUsage`, `getLimits`,
   `getSessions`, `getRecentActivity`; optionally `stopSession`, `subscribe`).
2. Add it to `src/providers/registry.ts`.

No component changes. The UI only ever reads the normalized model, so a new
provider appears in the usage list, the agent feed, the timeline, the project
breakdown and the history plot without touching any of them.

```ts
{
  provider: { id: "codex", name: "Codex", status: "active", connected: true },
  usage:    { percentage: 22, remaining: 1170, resetAt: 1761..., source: "local" },
  sessions: [{ project: "opspulse", currentActivity: "Running tests", ... }],
}
```

---

## Security

- Credentials go to the OS keychain (Keychain / Credential Manager / Secret
  Service) and **never** to SQLite, a config file, a log, or the UI. The only
  question the webview may ask is whether a credential exists — `has_credential`
  returns a boolean; nothing returns a secret.
- The webview holds no filesystem, shell or HTTP permission. Every local read
  happens in Rust behind a named command (`src-tauri/capabilities/default.json`).
- `open_path` and `open_terminal` accept only a directory that exists, and pass
  it as an argument to a fixed program rather than interpolating it into a
  shell string.
- A strict CSP is set in `tauri.conf.json`; the app makes no network requests.

## Performance

It is a background utility, so idle cost is a design constraint rather than an
optimization:

- **No polling.** A debounced file watcher drives refreshes, and it drops events
  entirely while the panel is hidden.
- **Adaptive edge sampling.** 260ms while the cursor is far from the edge, 40ms
  within 120px, and the thread parks when edge activation is off.
- **Bounded reads.** Transcripts are filtered by mtime before being opened, at
  most 24 are read, and each is read as a 64KB tail plus one head line — never
  whole.
- **Nothing animates at rest**, and the elapsed-time clock is a single shared
  interval that only runs while a session is actually counting.

## Design

`DESIGN.md` holds the visual system ("Console": a floating two-column panel,
true-neutral surfaces, one color per category used everywhere that category
appears, dark-first with a real light theme). `PRODUCT.md` holds the product
record.

- **Left:** a card per category (Claude Code, Codex, Agent sessions) with usage
  left and a seven-day chart. Hover a card and its slice of the weekly split
  lights up on the right, and the reverse.
- **Right:** a one-sentence forecast ("At that pace Claude Code runs out in
  1h 21m, before it resets in 1h 50m. est."), the week's split by provider, and
  the agents. Select an agent to open its status: every step it took, how long
  each took, and the actions that genuinely work for it.

Two things the design deliberately does not show, because they would not be
true: a step total ("Step 5 of 6" — a live agent has none) and Approve or Pause
buttons (neither CLI accepts them from another process). A waiting agent offers
*Respond in terminal* instead.

Motion has one authored moment: the panel arriving from the edge while its
charts draw in. A keyboard-summoned open deliberately has **no** entrance — it
is a high-frequency action, and 300ms between the keypress and the answer every
time is worse than no animation. `prefers-reduced-motion` is honored, and
Settings can reduce or disable motion outright.
