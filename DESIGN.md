# Design

<!-- impeccable:design-schema 1 -->

## Visual World: Instrument Panel

**Lineage.** Measurement hardware: a bench multimeter, a studio channel strip, an aircraft annunciator panel. Instruments earn trust by being legible at a glance, identical every time, and honest about precision. They are dense without being loud, and nothing on their face is decoration.

**What that means here.** The panel is a faceplate, not a web page. Structure comes from hairline rules and spacing, never from nested cards. Numbers are the subject and get the best typography in the system. Meters read as calibrated scales with tick marks, not as candy-colored progress pills. Color is almost absent — it appears only where it carries state, which is exactly what makes a single amber dot readable from across a desk.

**Anti-reference.** The AI-product dashboard: gradient cards, glowing accents, rounded-everything, a hero metric in 72px, four colors competing. If a decision could appear on an AI startup landing page, it is wrong here.

## Mode

**Operate.** The user completes a glance-and-dismiss task. Scanability, consistency, native expectations, and the real usage scene (a panel over a dark editor, read in two seconds) outrank expression. The brand lives in precise details: the tick marks on a meter, the tabular numerals that do not shift as a timer counts, the way a status dot's word sits next to it.

## Theme

Dark-first, light supported, OS-following by default with a Settings override. Picked from the use scene: the panel slides over a code editor, and most of those are dark. Light is a real theme built from the same tokens, not a stylesheet afterthought — the user on a light editor in a bright room gets the same instrument.

## Color

A near-neutral graphite ground with one cool accent. Every token is defined in both themes in `src/styles/tokens.css` on `:root` / `[data-theme]`.

### Dark (primary)

| Role | Token | Value | Use |
|---|---|---|---|
| Ground | `--surface-0` | `#0c0d10` | Panel backdrop, behind everything |
| Faceplate | `--surface-1` | `#131519` | The panel's own material |
| Raised | `--surface-2` | `#191c21` | Hover rows, meter troughs |
| Sunken | `--surface-inset` | `#0a0b0e` | Inset wells (meter channel, history plot) |
| Hairline | `--rule` | `#23262c` | The structural line — the system's workhorse |
| Hairline strong | `--rule-strong` | `#2e323a` | Section boundaries |
| Primary text | `--text-1` | `#e6e8ec` | Values, names, headings |
| Secondary text | `--text-2` | `#9ba3ae` | Labels, meta, timestamps |
| Tertiary text | `--text-3` | `#6b7380` | Axis ticks, provenance marks |
| Accent | `--accent` | `#4da3ff` | Focus, selection, the one live highlight |
| Accent sunken | `--accent-dim` | `#18314d` | Accent well, selection ground |

### Semantic state

Instrument-grade, desaturated — readable, never festive. Each is paired with a word in the UI, never color alone.

| State | Dark | Light | Meaning |
|---|---|---|---|
| OK / Active | `#3fb950` | `#1a7f37` | Operating normally |
| Idle | `#7d8590` | `#6e7781` | Connected, nothing running |
| Warn | `#d29922` | `#9a6700` | Approaching a limit |
| Error / Offline | `#f85149` | `#cf222e` | Needs attention |

### Rules

- Accent is a single hue. No second accent, no gradients, no gradient text.
- Secondary text on a tinted surface is tinted from that hue, never flat gray.
- Meter fill uses the state color at the usage level it represents, so the bar and the dot always agree.

## Typography

Two self-hosted faces, both chosen for data legibility rather than character.

- **Inter Variable** (`@fontsource-variable/inter`) — all UI text. `font-feature-settings: "tnum" 1, "cv05" 1, "ss03" 1`: tabular numerals so a counting timer never shifts width, and the disambiguated l/I forms that matter in project names.
- **JetBrains Mono Variable** (`@fontsource-variable/jetbrains-mono`) — measurement only: elapsed timers, file paths, session ids, axis values. Mono here is for *data and measurement*, never as a costume for "technical".

### Scale

Small and tight, because the panel is 380px wide and read at desk distance.

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `--t-display` | 20px / 24px | 560 | -0.02em | The one large number, if any |
| `--t-value` | 15px / 20px | 540 | -0.015em | Usage percentages, counts |
| `--t-body` | 12.5px / 17px | 450 | -0.005em | Names, messages |
| `--t-label` | 11px / 14px | 520 | 0.01em | Field labels |
| `--t-section` | 10px / 12px | 600 | 0.08em | Section headers, uppercase |
| `--t-meta` | 10.5px / 13px | 450 | 0.005em | Timestamps, provenance |

Section headers are uppercase, tracked out, in `--text-3`. They are the only uppercase in the system. No kickers or eyebrows anywhere — a ban, not a preference.

## Space

4px base. Tokens `--s-1` (4) through `--s-8` (32). Tight inside a group, generous between groups; more space above a heading than below it, so a header binds to the content it introduces.

- Panel padding: 14px horizontal, 12px vertical.
- Row height: 28px minimum for a pointer target, 20px for a pure data line.
- Between sections: a `--rule` hairline plus 14px above / 10px below.

## Form

- **Radius:** `--r-sm` 3px, `--r-md` 5px, `--r-lg` 7px. The panel's outer edge is 10px on the free side and 0 on the screen-edge side — it is attached to the edge, not floating near it.
- **Structure:** hairline rules and spacing. Cards are permitted only where a thing is genuinely liftable (an agent session row on hover); nested cards never.
- **Depth:** `--shadow-panel: -12px 0 36px -8px rgb(0 0 0 / 0.55), 0 0 0 1px var(--rule)`. Real offset plus soft blur, mirrored for the left edge. No zero-offset halos.
- **Meters:** a 4px inset channel with a 1px tick every 10%, filled from the left with the state color. The ticks are the calibration — they make the bar a scale instead of a decoration, and they are what distinguishes this from every other progress bar.

## Icons

Lucide, 14px, 1.5px stroke, consistently. Never a Unicode glyph or emoji standing in for an icon. Status is a drawn 6px dot plus its word, not an icon.

## Motion

Owned by one authored moment: the panel arriving from the edge. Everything else is a state change rendered quickly and quietly.

| Moment | Spec |
|---|---|
| Panel enter | Spring, x from ±100% to 0, opacity 0→1. `stiffness 420, damping 36, mass 0.9` — physical, arrives settled, no overshoot past the edge. |
| Panel exit | 140ms `cubic-bezier(0.32, 0.72, 0, 1)`, x to ±16px plus opacity to 0. Fast but not snapped. |
| Content stagger | 18ms per section, 6px rise, capped at 7 steps. Rides the panel's arrival once; never replays on data change. |
| Meter / number | 420ms exponential ease-out on the fill and on the digits. Numbers tween, they never jump. |
| Status change | 180ms crossfade on the dot color. The word swaps instantly — text must not be mid-fade when read. |
| Hover | 90ms, opacity and background only. Max 1px of movement anywhere in the product. |
| Notification | 220ms spring in from the top, 6px rise. |

At rest the product animates nothing. Under `prefers-reduced-motion` the panel presents instantly with opacity only, stagger is removed, and meters and digits settle without tweening.

## Browser surfaces

The parts not drawn still carry the design, and they ship with defaults belonging to no design system. All are themed from the palette:

- `::selection` — accent at 22%, text unchanged.
- `caret-color` — accent.
- Scrollbars — 6px, `--rule-strong` thumb, transparent track, no arrows; `scrollbar-width: thin` for the Firefox/WebKitGTK path.
- Focus ring — `0 0 0 2px var(--surface-1), 0 0 0 3px var(--accent)`, `:focus-visible` only.
- Tabular numerals on every numeric node, so no value shifts width as it changes.
- `-webkit-user-select: none` on chrome, re-enabled on copyable data.
- No text decoration skip defaults left unset; underline offset 2px where links exist.

## Copy

The product's own voice: precise, literal, measured.

- Labels name the quantity: "Remaining", "Resets", "Active".
- Controls name the action: "Open project", "Copy session", "Refresh".
- Errors name the problem and the recovery: "Codex state unreadable — check that the CLI has run at least once."
- Provenance is a word, not a tooltip-only secret: `local` and `est.` render inline in `--text-3`.
- No exclamation marks. No "Great news". No congratulation.

## Component inventory

`StatusDot` · `Meter` (calibrated) · `ProviderCard` · `SessionRow` · `ActivityRow` · `Timeline` · `UsageHistory` (7-day) · `ProjectBreakdown` · `SectionHeader` · `NotificationStack` · `ProvenanceTag` · `IconButton` · `Toggle` · `Select` · `Slider` · `ShortcutRecorder` · `SettingsPane`.
