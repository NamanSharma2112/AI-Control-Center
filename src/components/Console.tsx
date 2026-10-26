import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useApp } from '@/store/app';
import { forecastSentence, weeklySplit, type Run } from '@/lib/insights';
import type { CategoryId } from '@/lib/categories';
import type { Session } from '@/types/domain';
import { HOUR } from '@/lib/time';
import { StackedBar } from './StackedBar';
import { AgentCard } from './agent/AgentCard';
import { ActivityList, Empty } from './ActivityList';
import { ProjectList } from './ProjectList';
import { NotificationStack } from './NotificationStack';
import { StatusDot, type Tone } from '@/components/ui/StatusDot';
import { cn } from '@/lib/cn';
import type { MotionIntensity } from '@/store/settings';

type Tab = 'agents' | 'activity' | 'projects';

const SYSTEM_TONE: Record<'ok' | 'warn' | 'error' | 'idle', Tone> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  idle: 'idle',
};

/** Finished sessions stay visible this long, so "it just finished" is seen. */
const RECENT_DONE = 6 * HOUR;

/**
 * The right column: the answer in a sentence, the week in one bar, and the
 * agents themselves.
 */
export function Console({
  focus,
  onFocus,
  animate,
  live,
  intensity,
  now,
}: {
  focus: CategoryId | null;
  onFocus: (id: CategoryId | null) => void;
  animate: boolean;
  live: boolean;
  intensity: MotionIntensity;
  now: number;
}) {
  const snapshots = useApp((s) => s.snapshots);
  const sessions = useApp((s) => s.sessions);
  const activities = useApp((s) => s.activities);
  const history = useApp((s) => s.history);
  const projects = useApp((s) => s.projects);
  const system = useApp((s) => s.system);
  const refreshing = useApp((s) => s.refreshing);
  const refresh = useApp((s) => s.refresh);
  const setRoute = useApp((s) => s.setRoute);
  const notifications = useApp((s) => s.notifications);
  const dismiss = useApp((s) => s.dismissNotification);

  const shares = useMemo(() => weeklySplit(history), [history]);
  const weekTotal = useMemo(() => shares.reduce((sum, s) => sum + s.count, 0), [shares]);
  // The forecast only needs minute precision; recomputing per second would
  // make the sentence flicker between "1h 21m" and "1h 20m" for no reason.
  const minute = Math.floor(now / 60_000);
  const sentence = useMemo(
    () => forecastSentence(snapshots, weekTotal, minute * 60_000),
    [snapshots, weekTotal, minute],
  );

  // Ordered against the minute, not the second: which sessions count as
  // "recently finished" cannot change faster than that.
  const agents = useMemo(() => orderAgents(sessions, minute * 60_000), [sessions, minute]);
  const needsYou = agents.filter((s) => s.status === 'waiting').length;
  const working = agents.filter((s) => s.status === 'running').length;

  const [tab, setTab] = useState<Tab>('agents');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep a valid selection: the first agent by default (the one that needs
  // you, if any), and a new one if the selected session disappears.
  useEffect(() => {
    if (agents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !agents.some((a) => a.id === selectedId)) {
      setSelectedId(agents[0].id);
    }
  }, [agents, selectedId]);

  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  // Opening a card near the bottom would hide the part you opened it for, so
  // bring it into view once its body has opened. Only for a selection the
  // user made: the automatic default must never scroll the panel on open.
  const userSelected = useRef(false);
  useEffect(() => {
    if (!selectedId || !userSelected.current) return;
    const timer = window.setTimeout(() => {
      cardRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 340);
    return () => window.clearTimeout(timer);
  }, [selectedId]);
  const onAgentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      const delta =
        event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
            ? -1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = agents[(index + delta + agents.length) % agents.length];
      userSelected.current = true;
      setSelectedId(next.id);
      requestAnimationFrame(() => cardRefs.current.get(next.id)?.focus());
    },
    [agents],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-title text-text-1">AI Control Center</h1>
          <div className="mt-1 flex items-center gap-1.5">
            <StatusDot tone={SYSTEM_TONE[system.tone]} live={system.tone === 'ok'} />
            <span className="t-body truncate text-text-2">{system.label}</span>
          </div>
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center">
          <HeaderButton label="Refresh" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={15} strokeWidth={1.9} className={cn(refreshing && 'animate-spin')} />
          </HeaderButton>
          <HeaderButton label="Settings" onClick={() => setRoute('settings')}>
            <SettingsIcon size={15} strokeWidth={1.9} />
          </HeaderButton>
        </div>
      </header>

      <NotificationStack notifications={notifications} onDismiss={dismiss} intensity={intensity} />

      <Forecast runs={sentence} />

      <div className="mt-5">
        <StackedBar shares={shares} focus={focus} onFocus={onFocus} animate={animate} />
      </div>

      <Tabs
        tab={tab}
        onChange={setTab}
        counts={{ agents: agents.length }}
        attention={needsYou}
        animate={intensity === 'full'}
      />

      {/* Fades at both scroll edges say the list continues without a
          scrollbar shouting it. The padding matches each fade, so at rest
          nothing sits inside one. */}
      <div className="-mx-1 mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-3 pb-7 [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-28px),transparent)]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={intensity === 'full' ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="h-full"
          >
            {tab === 'agents' &&
              (agents.length === 0 ? (
                <Empty>No agents running. Start Claude Code or Codex and it appears here.</Empty>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={`Agents: ${working} running, ${needsYou} need you`}
                  className="space-y-2"
                >
                  {agents.map((session, i) => (
                    <AgentCard
                      key={session.id}
                      ref={(el) => {
                        if (el) cardRefs.current.set(session.id, el);
                        else cardRefs.current.delete(session.id);
                      }}
                      session={session}
                      now={now}
                      selected={session.id === selectedId}
                      onSelect={() => {
                        userSelected.current = true;
                        setSelectedId(session.id);
                      }}
                      animate={intensity === 'full'}
                      live={live}
                      tabIndex={session.id === selectedId ? 0 : -1}
                      onKeyDown={(e) => onAgentKeyDown(e, i)}
                    />
                  ))}
                </div>
              ))}
            {tab === 'activity' && <ActivityList activities={activities} animate={intensity === 'full'} />}
            {tab === 'projects' && <ProjectList projects={projects} animate={intensity === 'full'} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Needs-you first, then working, then what finished recently. */
function orderAgents(sessions: Session[], now: number): Session[] {
  const rank = { waiting: 0, running: 1, failed: 2, completed: 3 } as const;
  return sessions
    .filter(
      (s) =>
        s.status === 'running' ||
        s.status === 'waiting' ||
        now - s.lastActivityAt < RECENT_DONE,
    )
    .sort((a, b) => rank[a.status] - rank[b.status] || b.lastActivityAt - a.lastActivityAt);
}

function Forecast({ runs }: { runs: Run[] }) {
  return (
    <p className="t-body mt-4 max-w-[60ch] text-text-2 text-pretty">
      {runs.map((run, i) =>
        run.strong ? (
          <strong key={i} className="font-semibold text-text-1">
            {run.text}
          </strong>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}{' '}
      <span
        className="t-caption align-middle text-text-3"
        title="Projected from local activity, not reported by the provider"
      >
        est.
      </span>
    </p>
  );
}

function Tabs({
  tab,
  onChange,
  counts,
  attention,
  animate,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  counts: { agents: number };
  attention: number;
  animate: boolean;
}) {
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'agents', label: 'Agents', count: counts.agents },
    { id: 'activity', label: 'Activity' },
    { id: 'projects', label: 'Projects' },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === tab);
    if (event.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].id);
    if (event.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
  };

  return (
    <div
      role="tablist"
      aria-label="Panel view"
      onKeyDown={onKeyDown}
      className="mt-5 flex w-fit gap-0.5 rounded-full bg-inset p-0.5"
    >
      {tabs.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              't-label relative flex h-7 items-center gap-1.5 rounded-full px-3 transition-colors duration-150',
              active ? 'text-text-1' : 'text-text-2 hover:text-text-1',
            )}
          >
            {/* The indicator slides between tabs: continuity, not decoration. */}
            {active && (
              <motion.span
                layoutId="acc-tab-indicator"
                transition={animate ? { type: 'spring', stiffness: 520, damping: 40 } : { duration: 0 }}
                className="absolute inset-0 rounded-full bg-card-hover shadow-[0_1px_2px_rgb(0_0_0/0.25)]"
              />
            )}
            <span className="relative">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="t-caption relative text-text-3 tabular-nums">{t.count}</span>
            )}
            {t.id === 'agents' && attention > 0 && (
              <span className="relative size-1.5 rounded-full bg-warn" aria-label={`${attention} need you`} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-full text-text-2 transition-colors duration-100 hover:bg-card hover:text-text-1 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
