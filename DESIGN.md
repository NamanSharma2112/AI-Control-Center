# Design

<!-- impeccable:design-schema 1 -->

## Visual World: Console

**Lineage.** Two references the user pinned: a dark two-column credits console (category cards with charts on the left, a narrative and a selectable list on the right) and an agent-status component (a compact row that opens into a live step log). This replaced the earlier "Instrument Panel" strip; product truth was kept, the look was not.

**What that means here.** A floating panel of true neutrals in which the only color belongs to categories. Each category's color appears everywhere that category does, so the eye joins the two columns without reading labels. Numbers are large and light; units sit smaller beside them. Hierarchy comes from size and weight, never from uppercase or decoration.

**Anti-reference.** Gradient heroes, glow, glassmorphism, more than one color per meaning, and any control that promises something the CLIs cannot do (Approve, Pause, "Step 5 of 6").

## Mode

**Operate.** A glance-and-dismiss task: how much is left, what is running, what just happened. Interaction exists to drill into one agent, never to manage it.

## Layout

- Floating panel, default **880 × 640** (width 760–1040 in Settings), radius 22, 20px from the screen edge it was summoned from, vertically centered in the monitor's work area.
- The window is the panel plus that 20px margin, so any click outside the panel dismisses it.
- **Left column (0.9fr):** three metric cards, equal height — Claude Code, Codex, Agent sessions.
- **Right column (1.1fr):** title and system status · forecast sentence · weekly split bar and legend · tabs (Agents / Activity / Projects) · scrolling list. The right column is wider because it holds the interactive content.
- Below a 720px container width the columns stack and the whole panel scrolls (browser preview only; the desktop window never gets that narrow).

## Theme

Dark-first, light supported, following the OS by default. All tokens are in `src/styles/tokens.css` under `:root` and `[data-theme]`.

## Color

Neutrals carry no hue bias, so category colors are the only color in the panel.

| Role | Dark | Light |
|---|---|---|
| Panel | `#141414` | `#fbfbfb` |
| Card | `#1b1b1b` | `#f1f1f1` |
| Option row / selected | `#161616` / `#1a1a1a` | `#f7f7f7` / `#ffffff` |
| Row border / selected | `#232323` / `#dcdcdc` | `#e4e4e4` / `#1a1a1a` |
| Text 1 / 2 / 3 | `#f2f2f2` / `#8f8f8f` / `#6c6c6c` | `#141414` / `#5f5f5f` / `#858585` |
| Primary action | `#f2f2f2` on `#111111` | `#161616` on `#fafafa` |

### Categories

| Category | Dark | Light | Chart form |
|---|---|---|---|
| Claude Code | `#f5923e` | `#d2661a` | Bars |
| Codex | `#5b9dff` | `#2563eb` | Line with area |
| Agent sessions | `#f0659d` | `#cf3478` | Lollipop |

Each color names one thing: its card label, its chart, its stacked-bar segment, its legend dot, and the ring on its agents' avatars.

### State

OK `#3fb950`, warn `#e3a52a`, error `#f0524a`. Always paired with a word ("Needs you", "Done"). Success is the normal case and is not colored in lists; only problems take color.

## Typography

**Inter Variable** for UI, **JetBrains Mono Variable** for timers and durations only (measurement, never decoration). Tabular numerals everywhere digits change.

| Role | Size / line | Weight | Use |
|---|---|---|---|
| `t-figure` | 34 / 38 | 460, −0.035em | The card's number; its `%` is set at 0.62em |
| `t-title` | 17 / 22 | 600 | "AI Control Center", "Settings" |
| `t-strong` | 14 / 20 | 560 | Agent headline, emphasised figures in prose |
| `t-body` | 13 / 20 | 440 | Forecast, sub-lines, step labels |
| `t-label` | 13 / 18 | 540 | Card labels, tabs, buttons |
| `t-caption` | 11 / 14 | 460 | Axes, group headers, `est.` |
| `t-mono` | 12 / 16 | 460 | `03:23`, `1.9s` |

Sentence case throughout. No uppercase labels, no eyebrows.

## Components

- **Metric card** — label row (icon, colored name, state word); figure and unit bottom-left; one-line detail; chart right. Hover lights the matching bar segment and legend item; other cards step back to 60% opacity.
- **Chart** — seven days, three y-ticks on a rounded scale (labels name values the chart reaches), one-letter weekdays. Hover shows a column highlight and a tooltip with the day and value.
- **Stacked bar** — provider split of the week, 4px gaps between segments, legend with counts.
- **Forecast** — one sentence with the figures in a heavier weight, always ending in `est.`.
- **Agent card** — an option row that opens to its full status when selected:
  - Avatar: category glyph with a rotating arc while running, a warn badge when waiting, a check when done.
  - Headline: current step (rolls when it changes), or "Done in 19m · 6 files changed".
  - Sub-line: project · model on the left, state word or "Step N" on the right, aligned with the timer.
  - Open: one segment per step taken (no total), the last five steps with durations, and only real actions — Respond in terminal (primary, when waiting), Open terminal, Stop (where supported, two clicks), Copy, Open project.
- **Tabs** — pill group with a sliding indicator; the Agents tab carries a count and a warn dot when an agent needs you.

## Motion

One authored moment: arrival from the edge.

| Moment | Spec |
|---|---|
| Panel enter (edge or tray) | Spring from fully off screen, `stiffness 420, damping 36, mass 0.9` |
| Panel enter (shortcut) | None. A high-frequency keyboard action gets no entrance |
| Panel exit | 140ms `cubic-bezier(0.32,0.72,0,1)`, 16px nudge and fade |
| Charts | Bars and stems rise from the baseline, the line draws along its length, 550–700ms ease-out-expo, on open only |
| Stacked bar | Left-to-right `clip-path` reveal, 700ms, on open only |
| Agent card open | Height to its measured value, 320ms; body fades in after |
| Current step change | Old line leaves up, new arrives from below, 240ms with a 2px blur |
| Tab change | Indicator springs between tabs; content crossfades in 180ms |
| Hover | Background and opacity only, 100–150ms. Nothing moves |

Two loops exist, both only while an agent is actually working: the avatar arc and a sweep across the open step's segment. Both are transform-only and stop under reduced motion. Nothing else animates at rest.

## Browser surfaces

Selection, caret, scrollbars, focus rings (2px panel gap plus 2px focus blue), range thumbs and tabular numerals are all themed from the tokens. Scroll edges of the agent list fade instead of showing a hard cut.

## Copy

Precise and literal. Controls name their action ("Respond in terminal", "Open project"). Errors name the problem and the recovery. Derived numbers say `est.` or `local` every time they are shown.
