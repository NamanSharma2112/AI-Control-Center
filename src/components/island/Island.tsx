import { useMemo, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
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
/** The ghost is drawn once at this size and scaled, so it never re-renders. */
const GHOST_PX = 44;

/** Ease-in-out for the shape and everything in it: 250 ms to open, 150 ms to close. */
const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;
const OPEN = { duration: 0.25, ease: EASE_IN_OUT } as const;
const CLOSE = { duration: 0.15, ease: EASE_IN_OUT } as const;
/** The transition towards the state the island is heading for. */
const morph = (expanded: boolean) => (expanded ? OPEN : CLOSE);

/**
 * The ghost's expressions, built from what bot-avatars offers: its states,
 * a held head pose, a mouth, and things to wear. Poses are in radians.
 */
const MOODS: Record<Mood, Partial<BotAvatarProps>> = {
  // Eyes shut, breathing slowly.
  sleeping: { state: 'sleeping' },
  // Looking up and away, head a little tilted, slowed down: working it out.
  thinking: { state: 'default', pose: { yaw: -0.45, pitch: 0.42, roll: -0.12 }, speed: 0.7 },
  // Hopping and turning, headphones on: heads down on the task.
  working: { state: 'working', headphones: true },
  // Facing you, mouth open, eager.
  'needs-you': { state: 'default', face: 'mouth', pose: { pitch: 0.16 }, speed: 1.5 },
  // Head cocked to one side: something is not adding up.
  stuck: { state: 'default', pose: { yaw: 0.22, roll: 0.4 }, brightness: 0.9 },
  // A party hat: it finished.
  done: { state: 'default', face: 'mouth', hat: 'party', accessoryColor: '#4ade80' },
  // Looking down, a little dimmer: running low.
  low: { state: 'default', pose: { pitch: -0.32 }, brightness: 0.82 },
};

/** Moods with something going on, which the ghost animates even at rest. */
const LIVELY = new Set<Mood>(['thinking', 'working', 'needs-you', 'stuck']);

/**
 * The island. Collapsed, it is a pill with the ghost and one line: the most
 * important thing your agents are doing. Hovered, the same shape grows into
 * a card with every agent, usage left, and the way into the full panel.
 *
 * Clicking it opens the full panel; clicking an agent opens the panel on that
 * agent.
 *
 * The pill is the card's header: hover does not swap one thing for another,
 * it grows one shape and reveals what was beneath. The ghost is a single
 * instance throughout, so it never restarts mid-blink.
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none flex h-full w-full items-start justify-center pt-2.5">
        <motion.div
          layout
          transition={morph(expanded)}
          initial={false}
          animate={{ opacity: present ? 1 : 0, scale: present ? 1 : 0.92 }}
          onPointerEnter={() => onHover?.(true)}
          onPointerLeave={() => onHover?.(false)}
          style={{ borderRadius: expanded ? 26 : 22, width: expanded ? 440 : 'auto' }}
          className={cn(
            'pointer-events-auto relative max-w-[360px] overflow-hidden bg-[#0a0a0b] text-white',
            'shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6),0_0_0_1px_rgb(255_255_255/0.08)]',
            expanded && 'max-w-[440px]',
          )}
        >
          <Header
            summary={summary}
            expanded={expanded}
            now={now}
            counts={counts}
            series={series}
            onOpenPanel={() => onOpenPanel()}
            onClose={onClose}
          />

          <AnimatePresence initial={false} mode="popLayout">
            {expanded && (
              <motion.div
                key="body"
                initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: OPEN }}
                exit={{ opacity: 0, y: -6, filter: 'blur(3px)', transition: { duration: 0.1, ease: EASE_IN_OUT } }}
                className="px-3 pb-3"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

function Ghost({ summary, expanded }: { summary: IslandSummary; expanded: boolean }) {
  const size = expanded ? 40 : 28;
  return (
    <motion.div
      layout
      transition={morph(expanded)}
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <motion.div
        className="absolute top-0 left-0 origin-top-left"
        animate={{ scale: size / GHOST_PX }}
        transition={morph(expanded)}
        style={{ width: GHOST_PX, height: GHOST_PX }}
      >
        <BotAvatar
          type="ghost"
          color={GHOST_COLOR}
          size={GHOST_PX}
          jumpHeight={14}
          jumpStretch={0.6}
          {...MOODS[summary.mood]}
          // Always on screen, so it only animates when there is something to
          // show: agents at work, or you looking at it. Otherwise it holds
          // still and costs nothing.
          paused={!LIVELY.has(summary.mood) && !expanded}
        />
      </motion.div>
    </motion.div>
  );
}

const TONE_TEXT: Record<IslandSummary['tone'], string> = {
  attention: 'text-[#f5b14a]',
  done: 'text-white',
  working: 'text-white',
  quiet: 'text-white/70',
};

function Header({
  summary,
  expanded,
  now,
  counts,
  series,
  onOpenPanel,
  onClose,
}: {
  summary: IslandSummary;
  expanded: boolean;
  now: number;
  counts: { working: number; needsYou: number };
  series: number[];
  onOpenPanel: () => void;
  onClose: () => void;
}) {
  const status =
    counts.working + counts.needsYou === 0
      ? 'Nothing running'
      : [counts.working && `${counts.working} working`, counts.needsYou && `${counts.needsYou} need you`]
          .filter(Boolean)
          .join(' · ');

  return (
    // The whole pill is a way into the panel; the button below is the
    // keyboard's way in.
    <motion.div
      layout="position"
      transition={morph(expanded)}
      onClick={onOpenPanel}
      title="Open full panel"
      className={cn(
        'flex cursor-pointer items-center gap-2.5',
        expanded ? 'px-3 pt-3 pb-2.5' : 'h-10 py-1.5 pr-3.5 pl-2',
      )}
    >
      <Ghost summary={summary} expanded={expanded} />

      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={expanded ? 'card' : `pill:${summary.title}:${summary.detail ?? ''}`}
            initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
            transition={morph(expanded)}
            className="min-w-0"
          >
            {expanded ? (
              <>
                <p className="t-strong truncate text-white">AI Control Center</p>
                <p className={cn('t-caption mt-0.5 truncate', counts.needsYou ? 'text-[#f5b14a]' : 'text-white/55')}>
                  {status}
                </p>
              </>
            ) : (
              <p className="t-label max-w-[200px] truncate whitespace-nowrap">
                <span className={TONE_TEXT[summary.tone]}>{summary.title}</span>
                {summary.detail && <span className="text-white/45"> · {summary.detail}</span>}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {expanded ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Open full panel" onClick={onOpenPanel}>
            <Maximize2 size={14} strokeWidth={2} />
          </IconButton>
          <IconButton label="Close the island" onClick={onClose}>
            <X size={15} strokeWidth={2.2} />
          </IconButton>
        </div>
      ) : (
        <>
          <Sparkline values={series} tone={summary.tone} />
          <Trailing summary={summary} now={now} />
        </>
      )}
    </motion.div>
  );
}

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
