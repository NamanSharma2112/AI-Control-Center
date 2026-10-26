# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri 2 + Rust (desktop shell, OS integration, SQLite) and React 19 + TypeScript + Vite + Tailwind CSS 4 (panel UI), with Zustand for state and Motion for React for animation. Local-first: no backend service. Targets Windows 11 and macOS.

## Users

A single primary user: a developer who delegates work to AI coding agents (Claude Code, Codex) and runs several of them across several projects at once. Their situation is mid-task at a desk, inside an editor or terminal, with the agents' own windows buried behind the work. The job is a glance, not a session: confirm how much provider budget is left, see what every agent is doing right now, and catch up on what finished while they were heads-down — without switching apps, opening a browser tab, or breaking their current train of thought.

## Product Purpose

AI Control Center is a background desktop utility that answers three questions in under two seconds, from anywhere on the desktop:

1. How much AI usage do I have left?
2. What are my AI agents doing right now?
3. What have my agents been doing recently?

Success is that the user stops opening provider web pages and terminal tabs to check on their agents, and that the panel is fast and calm enough that they reach for it reflexively. Anything that does not serve one of the three questions is out of scope for V1.

## Positioning

Provider dashboards each show one provider, from inside that provider's own app, and show nothing about local agent sessions. Terminals show one session at a time and forget it on close. AI Control Center is the only surface that unifies *every* provider and *every* local agent session into one normalized, always-available edge panel — summoned by a cursor gesture rather than by finding a window.

The mechanism a neighboring product could not truthfully copy: a provider adapter layer that normalizes heterogeneous provider data behind one interface, combined with edge-activated instant presentation and explicit provenance labelling on every number.

## Operating Context

- The user keeps the app running permanently; it lives in the system tray (Windows) / menu bar (macOS) and has no primary window.
- Summoning is a reflex: a cursor push into a configured screen edge, or a global keyboard shortcut. Dismissal is clicking away or pressing Escape.
- The panel appears over whatever the user is already doing, most often a dark code editor at a desk under ordinary indoor light.
- Agents are local CLI processes (Claude Code, Codex) working inside git repositories; "project" means the repository directory an agent session is working in.
- Agent activity is read from the CLIs' own local state on disk — session and history files the user already owns — watched for changes rather than polled.
- Provider usage limits reset on provider-defined schedules (rolling windows and weekly resets), so "time until reset" matters as much as the percentage.

## Capabilities and Constraints

Confirmed capabilities for V1:

- Borderless, always-on-top, decoration-free floating panel pinned to the left or right screen edge, on the monitor containing the cursor.
- Edge activation with configurable sensitivity and dwell time; global toggle shortcut; tray/menu-bar icon; click-away and Escape dismissal; runs headless in the background.
- Provider usage, limits, reset times, status; active agent sessions with project and current activity; a unified recent-activity feed; a day summary; a 7-day usage history; a project breakdown; notifications; a small set of controls (open project, open terminal, copy session info, refresh, stop a supported local task).
- Local SQLite persistence for provider metadata, usage snapshots, sessions, activities, projects, preferences, and notification settings.
- A provider adapter interface (`getUsage`, `getLimits`, `getSessions`, `getStatus`, `getRecentActivity`) with a mock implementation and a real local implementation per provider, interchangeable without UI changes.

Hard constraints:

- Local-first and offline-capable. No backend. No user activity leaves the device without explicit consent.
- No website scraping, no reading browser cookies, no bypassing provider authentication.
- Credentials never live in ordinary SQLite tables or in source; they go to the OS keychain / Credential Manager via Tauri's secure storage, and are never rendered in the UI or written to logs.
- Every displayed value carries provenance: `provider` (reported by the provider), `local` (computed from local state the user owns), or `estimated` (derived/inferred). Local and estimated values are visibly marked. Locally-derived numbers are never presented as official provider figures.
- Idle cost must be negligible: event-driven file watching with debounce, no animation at rest, no busy polling, no filesystem sweeps.

Explicitly undecided: which additional providers come after Codex and Claude Code; whether any provider exposes an official usage API the adapters can later call.

## Brand Commitments

Name: "AI Control Center". Voice: precise, quiet, and literal — a measurement instrument's voice. It states values and states; it does not sell, congratulate, or exclaim. No marketing register anywhere in the product.

## Evidence on Hand

- Real local agent state exists on disk for both providers (CLI session and history files) and is the source for real agent activity, sessions, and projects.
- No provider-published usage API is confirmed available. Until one is, usage figures are locally derived and must be labelled as such.
- No testimonials, customers, benchmarks, pricing, or deployment claims exist. Future work must not fabricate any.

## Product Principles

1. **Three questions.** Usage left, agents now, agents recently. A feature that does not serve one of them does not ship in V1.
2. **A glance, not a session.** The panel is read in two seconds and dismissed. Density serves scanning; nothing demands interaction.
3. **Provenance is a feature.** A number the product inferred is never dressed as a number a provider reported.
4. **Invisible until summoned.** The app's resting state costs nothing: no polling, no animation, no window.
5. **The device is the boundary.** Data stays local by default; credentials live only in the OS keychain.

## Accessibility & Inclusion

- Full keyboard operation: toggle, traverse, act, dismiss — the panel is never mouse-only, since edge activation is an accelerator and not the only route in.
- Honor `prefers-reduced-motion`: the slide-in becomes an instant, opacity-only presentation; progress and number transitions settle immediately.
- Status is never carried by color alone; each status pairs its dot with a word.
- Body and placeholder text at 4.5:1 or better in both themes; visible focus rings drawn from the palette.
