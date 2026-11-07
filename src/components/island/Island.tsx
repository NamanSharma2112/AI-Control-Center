import { useMemo } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { BotAvatar } from 'bot-avatars';
import { Check, Maximize2, SquareTerminal, TriangleAlert } from 'lucide-react';
import type { Session } from '@/types/domain';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { useTicker } from '@/hooks/useTicker';
import { islandAgents, summarize, type IslandSummary } from '@/lib/island';
import { CATEGORIES } from '@/lib/categories';
import { PROVIDER_NAMES } from '@/providers/registry';
import { formatCountdown, formatElapsed } from '@/lib/time';
import { jumpToAgent } from '@/lib/actions';
import { cn } from '@/lib/cn';

/** The ghost from namansharma.com: bot-avatars' ghost in a soft blue. */
const GHOST_COLOR = '#8cb2ff';
/** The ghost is drawn once at this size and scaled, so it never re-renders. */
const GHOST_PX = 44;

/** One spring for the whole morph, with a little of the island's bounce. */
const MORPH = { type: 'spring', stiffness: 400, damping: 30, mass: 0.9 } as const;
const FADE = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const;

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
}: {
  expanded: boolean;
  /** False while a hover-only island is fading away. */
  present?: boolean;
  /** Browser preview only: the desktop app tracks hover natively. */
  onHover?: (hovering: boolean) => void;
  /** Opens the full panel, on one agent if given. */
  onOpenPanel: (agentId?: string) => void;
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

  const counts = {
    working: sessions.filter((s) => s.status === 'running').length,
    needsYou: sessions.filter((s) => s.status === 'waiting' && s.waitingReason !== 'idle').length,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none flex h-full w-full items-start justify-center pt-2.5">
        <motion.div
          layout
          transition={MORPH}
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
          <Header summary={summary} expanded={expanded} now={now} counts={counts} onOpenPanel={() => onOpenPanel()} />

          <AnimatePresence initial={false} mode="popLayout">
            {expanded && (
              <motion.div
                key="body"
                initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { ...FADE, delay: 0.06 } }}
                exit={{ opacity: 0, y: -6, filter: 'blur(3px)', transition: { duration: 0.12 } }}
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
      transition={MORPH}
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <motion.div
        className="absolute top-0 left-0 origin-top-left"
        animate={{ scale: size / GHOST_PX }}
        transition={MORPH}
        style={{ width: GHOST_PX, height: GHOST_PX }}
      >
        <BotAvatar
          type="ghost"
          color={GHOST_COLOR}
          state={summary.ghost}
          size={GHOST_PX}
          jumpHeight={14}
          jumpStretch={0.6}
          // Always on screen, so it only animates when there is something to
          // show: agents at work, or you looking at it. Otherwise it holds
          // still and costs nothing.
          paused={!summary.active && !expanded}
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
  onOpenPanel,
}: {
  summary: IslandSummary;
  expanded: boolean;
  now: number;
  counts: { working: number; needsYou: number };
  onOpenPanel: () => void;
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
      transition={MORPH}
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
            transition={FADE}
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
              <p className="t-label max-w-[250px] truncate whitespace-nowrap">
                <span className={TONE_TEXT[summary.tone]}>{summary.title}</span>
                {summary.detail && <span className="text-white/45"> · {summary.detail}</span>}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {expanded ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPanel();
          }}
          aria-label="Open full panel"
          title="Open full panel"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/60 transition-colors duration-100 hover:bg-white/10 hover:text-white"
        >
          <Maximize2 size={14} strokeWidth={2} />
        </button>
      ) : (
        <Trailing summary={summary} now={now} />
      )}
    </motion.div>
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
