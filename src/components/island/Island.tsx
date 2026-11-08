import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { BotAvatar, type BotAvatarProps } from 'bot-avatars';
import { Check, Maximize2, SquareTerminal, TriangleAlert, X } from 'lucide-react';
import type { Session } from '@/types/domain';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { useTicker } from '@/hooks/useTicker';
import { activitySeries, islandAgents, summarize, type IslandSummary, type Mood } from '@/lib/island';
import { CATEGORIES } from '@/lib/categories';
import { PROVIDER_NAMES } from '@/providers/registry';
import { formatCountdown, formatElapsed } from '@/lib/time';
import { jumpToAgent } from '@/lib/actions';
import { cn } from '@/lib/cn';

/** The ghost from namansharma.com: bot-avatars' ghost in a soft blue. */
const GHOST_COLOR = '#8cb2ff';
/** The ghost is drawn once at this size and scaled down, so it stays sharp
 * and never re-renders when the island opens. */
const GHOST_PX = 64;

/** Ease-in-out for the shape and everything in it: 250 ms to open, 150 ms to close. */
const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;
const OPEN = { duration: 0.25, ease: EASE_IN_OUT } as const;
const CLOSE = { duration: 0.15, ease: EASE_IN_OUT } as const;
/** The transition towards the state the island is heading for. */
const morph = (expanded: boolean) => (expanded ? OPEN : CLOSE);
const INSTANT = { duration: 0 } as const;
/** The two layers never show at once: the outgoing one fades first, and the
 * incoming one fades in over the rest of the shape's move. */
const LAYER_OUT = { duration: 0.08, ease: EASE_IN_OUT } as const;
const LAYER_IN_OPENING = { duration: 0.15, delay: 0.1, ease: EASE_IN_OUT } as const;
const LAYER_IN_CLOSING = { duration: 0.08, delay: 0.07, ease: EASE_IN_OUT } as const;
/** The ghost lands a little before the card's text is readable beside it. */
const GHOST_OPENING = { duration: 0.2, ease: EASE_IN_OUT } as const;

/** Sizes and the ghost's spots in each, in px. */
const CARD_W = 440;
const PILL_H = 44;
const PILL_MAX_W = 360;
const GHOST_PILL = { size: 32, left: 8, top: 6 };
const GHOST_CARD = { size: 44, left: 12, top: 12 };

/**
 * The ghost's expressions. Each one is a way of moving, never a held pose:
 * holding a pose stops the library's own head turns, glances and hops, and
 * the ghost goes still as a picture. So a mood is how far the head turns,
 * how fast it all runs, how often it hops, its face, and what it wears.
 */
const MOODS: Record<Mood, Partial<BotAvatarProps>> = {
  // Eyes shut, breathing slowly.
  sleeping: { state: 'sleeping' },
  // Slow, wide looks around through round glasses: working something out.
  thinking: { state: 'default', glasses: 'round', turn: 1.7, speed: 0.75, jumpEvery: 0 },
  // Hopping and spinning with headphones on: heads down on the task.
  working: { state: 'working', headphones: true, whirl: 1, speed: 1.1 },
  // Mouth open, quick, hopping every couple of seconds to get your attention.
  'needs-you': { state: 'default', face: 'mouth', speed: 1.6, turn: 0.6, jumpEvery: 2.4 },
  // Darting looks from side to side, fast: something is not adding up.
  stuck: { state: 'default', face: 'mouth', speed: 2, turn: 2, jumpEvery: 0, brightness: 0.92 },
  // A party hat and a little hop now and then: it finished.
  done: { state: 'default', face: 'mouth', hat: 'party', accessoryColor: '#4ade80', jumpEvery: 3.5 },
  // Slow and dim, barely turning: running low.
  low: { state: 'default', speed: 0.55, turn: 0.35, jumpEvery: 0, brightness: 0.8 },
};

/**
 * The island. Collapsed, it is a pill with the ghost and one line: the most
 * important thing your agents are doing. Hovered, the same shape grows into
 * a card with every agent, usage left, and the way into the full panel.
 *
 * Clicking it opens the full panel; clicking an agent opens the panel on that
 * agent.
 *
 * Hover grows one shape: its real width and height animate (never a scale,
 * which would stretch the text inside), the pill's content fades out, and
 * the card's content, already laid out at full size, fades in as the shape
 * reveals it. The ghost is a single instance throughout, gliding from its
 * place in the pill to its place in the card, so it never restarts.
 */
export function Island({
  expanded,
  present = true,
  onHover,
  onOpenPanel,
  onClose,
}: {
  expanded: boolean;
  /** False while a hover-only island is fading away. */
  present?: boolean;
  /** Browser preview only: the desktop app tracks hover natively. */
  onHover?: (hovering: boolean) => void;
  /** Opens the full panel, on one agent if given. */
  onOpenPanel: (agentId?: string) => void;
  /** Hides the island (until it is turned back on). */
  onClose: () => void;
}) {
  const sessions = useApp((s) => s.sessions);
  const snapshots = useApp((s) => s.snapshots);
  const threshold = useSettings((s) => s.settings.notifyUsageThreshold);

  const live = sessions.some((s) => s.status === 'running' || s.status === 'waiting');
  const now = useTicker(live || expanded);

  // The line is re-decided when the data changes or a minute passes, not on
  // every tick of the timer.
  const minute = Math.floor(now / 60_000);
  const summary = useMemo(
    () => summarize(sessions, snapshots, threshold, minute * 60_000),
    [sessions, snapshots, threshold, minute],
  );
  const agents = useMemo(() => islandAgents(sessions, minute * 60_000), [sessions, minute]);
  const activities = useApp((s) => s.activities);
  const series = useMemo(
    () => activitySeries(activities, sessions, minute * 60_000),
    [activities, sessions, minute],
  );

  const counts = {
    working: sessions.filter((s) => s.status === 'running').length,
    needsYou: sessions.filter((s) => s.status === 'waiting' && s.waitingReason !== 'idle').length,
  };

  // The card's real size: it animates its width and height, never a scale,
  // so nothing inside it is ever stretched; it just reveals or clips what
  // it holds. The pill's width and the card's height are measured.
  const [pillRef, pillSize] = useElementSize<HTMLDivElement>();
  const [cardRef, cardSize] = useElementSize<HTMLDivElement>();
  const pillWidth = Math.min(PILL_MAX_W, pillSize.width || PILL_MAX_W);
  const width = expanded ? CARD_W : pillWidth;
  const height = expanded ? cardSize.height || PILL_H : PILL_H;

  // The first measurement is applied without animating, so the island does
  // not grow into place when it first appears.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled || !pillSize.width) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [settled, pillSize.width]);
  const shape = settled ? morph(expanded) : INSTANT;

  const status =
    counts.working + counts.needsYou === 0
      ? 'Nothing running'
      : [counts.working && `${counts.working} working`, counts.needsYou && `${counts.needsYou} need you`]
          .filter(Boolean)
          .join(' · ');

  return (
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none flex h-full w-full items-start justify-center pt-2.5">
        {/* Fading in and out (hover-only mode) is this wrapper's alone. */}
        <motion.div
          initial={false}
          animate={{ opacity: present ? 1 : 0, scale: present ? 1 : 0.92 }}
          transition={CLOSE}
          className="pointer-events-auto origin-top"
        >
          <motion.div
            initial={false}
            animate={{ width, height, borderRadius: expanded ? 26 : 22 }}
            transition={shape}
            onPointerEnter={() => onHover?.(true)}
            onPointerLeave={() => onHover?.(false)}
            style={{
              boxShadow: '0 10px 30px -8px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.08)',
            }}
            className="relative overflow-hidden bg-[#0a0a0b] text-white"
          >
            {/* The pill's content. Out first when opening, in last when closing. */}
            <motion.div
              ref={pillRef}
              initial={false}
              animate={{ opacity: expanded ? 0 : 1 }}
              transition={expanded ? LAYER_OUT : LAYER_IN_CLOSING}
              onClick={() => onOpenPanel()}
              title="Open full panel"
              aria-hidden={expanded}
              inert={expanded}
              className={cn(
                'absolute top-0 left-1/2 flex h-11 w-max max-w-[360px] -translate-x-1/2 cursor-pointer items-center gap-2.5 py-1.5 pr-3.5 pl-2',
                expanded && 'pointer-events-none',
              )}
            >
              <span className="size-8 shrink-0" aria-hidden="true" />
              <p className="t-label min-w-0 max-w-[200px] truncate whitespace-nowrap">
                <span className={TONE_TEXT[summary.tone]}>{summary.title}</span>
                {summary.detail && <span className="text-white/45"> · {summary.detail}</span>}
              </p>
              <Sparkline values={series} tone={summary.tone} />
              <Trailing summary={summary} now={now} />
            </motion.div>

            {/* The card's content, at its full width throughout: the shape
                around it grows to reveal it rather than squeezing it. */}
            <motion.div
              ref={cardRef}
              initial={false}
              animate={{ opacity: expanded ? 1 : 0 }}
              transition={expanded ? LAYER_IN_OPENING : LAYER_OUT}
              aria-hidden={!expanded}
              inert={!expanded}
              className={cn(
                'absolute top-0 left-1/2 w-[440px] -translate-x-1/2',
                !expanded && 'pointer-events-none',
              )}
            >
              <div
                onClick={() => onOpenPanel()}
                title="Open full panel"
                className="flex cursor-pointer items-center gap-2.5 px-3 pt-3 pb-2.5"
              >
                <span className="size-11 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="t-strong truncate text-white">AI Control Center</p>
                  <p className={cn('t-caption mt-0.5 truncate', counts.needsYou ? 'text-[#f5b14a]' : 'text-white/55')}>
                    {status}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label="Open full panel" onClick={() => onOpenPanel()}>
                    <Maximize2 size={14} strokeWidth={2} />
                  </IconButton>
                  <IconButton label="Close the island" onClick={onClose}>
                    <X size={15} strokeWidth={2.2} />
                  </IconButton>
                </div>
              </div>
              <div className="px-3 pb-3">
                <Agents agents={agents} now={now} onOpen={onOpenPanel} />
                <Usage now={now} />
                <button
                  type="button"
                  onClick={() => onOpenPanel()}
                  className="t-label mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-white/85 transition-colors duration-100 hover:bg-white/[0.12] hover:text-white"
                >
                  <Maximize2 size={13} strokeWidth={2} />
                  Open full panel
                </button>
              </div>
            </motion.div>

            {/* One ghost, gliding between its place in the pill and in the
                card, so it never restarts mid-blink. Its offsets are from the
                card's centre line, which stays put while the shape grows. */}
            <motion.div
              aria-hidden="true"
              initial={false}
              animate={{
                x: expanded ? -CARD_W / 2 + GHOST_CARD.left : -pillWidth / 2 + GHOST_PILL.left,
                y: expanded ? GHOST_CARD.top : GHOST_PILL.top,
                scale: (expanded ? GHOST_CARD.size : GHOST_PILL.size) / GHOST_PX,
              }}
              transition={!settled ? INSTANT : expanded ? GHOST_OPENING : CLOSE}
              style={{ width: GHOST_PX, height: GHOST_PX, originX: 0, originY: 0 }}
              className="pointer-events-none absolute top-0 left-1/2"
            >
              <BotAvatar
                type="ghost"
                color={GHOST_COLOR}
                size={GHOST_PX}
                jumpHeight={14}
                jumpStretch={0.6}
                // A thicker body than the default, so its 3D sides show as it turns.
                depth={0.9}
                {...MOODS[summary.mood]}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

/** The element's border-box size, kept current as it changes. */
function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const read = () => setSize({ width: element.offsetWidth, height: element.offsetHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}

const TONE_TEXT: Record<IslandSummary['tone'], string> = {
  attention: 'text-[#f5b14a]',
  done: 'text-white',
  working: 'text-white',
  quiet: 'text-white/70',
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // The header behind it opens the panel; this button does its own thing.
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-full text-white/60 transition-colors duration-100 hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

const SPARK_STROKE: Record<IslandSummary['tone'], string> = {
  attention: '#f5b14a',
  done: '#4ade80',
  working: GHOST_COLOR,
  quiet: 'rgb(255 255 255 / 0.3)',
};

/** How busy the agents have been over the last half hour, as a small line. */
function Sparkline({ values, tone }: { values: number[]; tone: IslandSummary['tone'] }) {
  const W = 40;
  const H = 16;
  const max = Math.max(1, ...values);
  const step = W / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [i * step, H - 1.5 - (v / max) * (H - 3)] as const);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const stroke = SPARK_STROKE[tone];
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 overflow-visible"
      role="img"
      aria-label={`${total} agent actions in the last half hour`}
    >
      <path d={area} fill={stroke} opacity={0.14} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Trailing({ summary, now }: { summary: IslandSummary; now: number }) {
  if (summary.timerFrom) {
    return <span className="t-mono shrink-0 text-white/60">{formatElapsed(summary.timerFrom, now)}</span>;
  }
  if (summary.tone === 'attention') {
    return <span className="size-2 shrink-0 rounded-full bg-[#f5b14a]" aria-hidden="true" />;
  }
  if (summary.tone === 'done') {
    return <Check size={14} strokeWidth={2.6} className="shrink-0 text-[#4ade80]" aria-hidden="true" />;
  }
  return null;
}

function Agents({
  agents,
  now,
  onOpen,
}: {
  agents: Session[];
  now: number;
  onOpen: (agentId: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <p className="t-caption rounded-xl bg-white/[0.05] px-3 py-3 text-white/55">
        No agents running. Start Claude Code or Codex and they appear here.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {agents.map((s) => (
        <AgentRow key={s.id} session={s} now={now} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function AgentRow({
  session,
  now,
  onOpen,
}: {
  session: Session;
  now: number;
  onOpen: (agentId: string) => void;
}) {
  const cat = CATEGORIES[session.providerId];
  const needsYou = session.status === 'waiting' && session.waitingReason !== 'idle';
  const done = session.status === 'completed';
  const word = needsYou ? 'Needs you' : done ? 'Done' : session.status === 'waiting' ? 'Idle' : null;

  return (
    <li
      className={cn(
        'group flex items-center rounded-xl transition-colors duration-100',
        needsYou ? 'bg-[#f5b14a]/[0.12] hover:bg-[#f5b14a]/[0.18]' : 'hover:bg-white/[0.07]',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        title={`Open ${session.project} in the panel`}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 pl-2.5 text-left"
      >
        <span className={cn('size-2 shrink-0 rounded-full', cat.bg, done && 'opacity-50')} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="t-label block truncate text-white">
            {session.project}
            <span className="font-normal text-white/40"> · {cat.label}</span>
          </span>
          <span className={cn('t-caption mt-0.5 block truncate', needsYou ? 'text-[#f5b14a]' : 'text-white/55')}>
            {session.stuck && !done ? (
              <span className="inline-flex items-center gap-1 text-[#f5b14a]">
                <TriangleAlert size={11} strokeWidth={2.2} />
                {session.stuck.command} failed {session.stuck.failures}×
              </span>
            ) : (
              session.currentActivity
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="t-mono text-white/70">
            {formatElapsed(session.startedAt, done ? session.lastActivityAt : now)}
          </span>
          {word && (
            <span className={cn('t-caption', needsYou ? 'text-[#f5b14a]' : 'text-white/40')}>{word}</span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void jumpToAgent(session)}
        aria-label={done ? `Open ${session.project}` : `Go to ${PROVIDER_NAMES[session.providerId]} in ${session.project}`}
        title={done ? `Open ${session.project}` : `Go to its terminal`}
        className={cn(
          'mr-1.5 grid size-7 shrink-0 place-items-center rounded-lg text-white/45 transition-[color,background-color,opacity] duration-100',
          'hover:bg-white/10 hover:text-white focus-visible:opacity-100',
          needsYou ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <SquareTerminal size={14} strokeWidth={2} />
      </button>
    </li>
  );
}

function Usage({ now }: { now: number }) {
  const snapshots = useApp((s) => s.snapshots);
  const rows = snapshots.filter((s) => s.provider.connected && s.usage);
  if (rows.length === 0) return null;
  return (
    <section className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2.5" aria-label="Usage left">
      <div className="space-y-2.5">
        {rows.map((snap) => {
          const usage = snap.usage!;
          const left = 100 - usage.percentage;
          const cat = CATEGORIES[snap.provider.id];
          return (
            <div key={snap.provider.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-label text-white">{snap.provider.name}</span>
                <span className="t-caption text-white/55">
                  <span className={cn('t-label', left <= 25 ? 'text-[#f5b14a]' : 'text-white')}>{left}%</span>{' '}
                  left
                  {usage.resetAt ? ` · resets in ${formatCountdown(usage.resetAt, now)}` : ''}
                  {usage.source !== 'provider' && <span className="text-white/35"> · est.</span>}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-500 ease-out', cat.bg)}
                  style={{ width: `${left}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
