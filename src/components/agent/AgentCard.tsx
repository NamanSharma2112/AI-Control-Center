import { memo, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Copy, Square, SquareTerminal } from 'lucide-react';
import type { Session, SessionStep } from '@/types/domain';
import { CATEGORIES } from '@/lib/categories';
import { formatModel, plural } from '@/lib/format';
import { formatDuration, formatElapsed } from '@/lib/time';
import { copySessionInfo, openProject, openTerminal } from '@/lib/actions';
import { useMeasure } from '@/hooks/useMeasure';
import { useApp } from '@/store/app';
import { cn } from '@/lib/cn';
import { ProviderAvatar } from './ProviderAvatar';
import { StepIcon } from './StepIcon';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Steps the open card lists. The segments above show up to MAX_SEGMENTS. */
const VISIBLE_STEPS = 5;
const MAX_SEGMENTS = 8;

interface AgentCardProps {
  ref?: Ref<HTMLDivElement>;
  session: Session;
  now: number;
  selected: boolean;
  onSelect: () => void;
  /** Motion allowed for state changes inside the card. */
  animate: boolean;
  /** Loops (spinner, sweep) allowed: panel visible and motion on. */
  live: boolean;
  tabIndex: number;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * One agent, answering "what is it doing right now" at a glance and "how did
 * it get here" when opened.
 *
 * Closed, it is a single option row: who, what, how long. Selected, it opens
 * into the full status card — segments for each step taken, the recent step
 * log with durations, and the actions that actually work for this session.
 * Only one card is open at a time, chosen by click or arrow keys rather than
 * by hover, so the list never reflows under a moving pointer.
 */
export const AgentCard = memo(function AgentCard({
  ref,
  session,
  now,
  selected,
  onSelect,
  animate,
  live,
  tabIndex,
  onKeyDown,
}: AgentCardProps) {
  const cat = CATEGORIES[session.providerId];
  const model = formatModel(session.model);
  const [measureRef, { height: bodyHeight }] = useMeasure<HTMLDivElement>();

  const done = session.status === 'completed' || session.status === 'failed';
  const waiting = session.status === 'waiting';
  const running = session.status === 'running';

  const headline = done
    ? `Done in ${formatDuration(session.lastActivityAt - session.startedAt)}${
        session.filesChanged ? ` · ${plural(session.filesChanged, 'file')} changed` : ''
      }`
    : session.currentActivity || (waiting ? 'Waiting for your input' : 'Working');

  const currentKind = session.steps[session.steps.length - 1]?.kind ?? 'command';
  const timer = done
    ? formatElapsed(session.startedAt, session.lastActivityAt)
    : formatElapsed(session.startedAt, now);

  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={selected}
      aria-label={`${cat.label}, ${session.project}: ${headline}`}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative cursor-default rounded-lg border px-3.5 py-3 outline-none',
        'transition-[border-color,background-color] duration-150 ease-out',
        selected
          ? 'border-row-border-selected bg-row-selected'
          : 'border-row-border bg-row hover:border-rule-strong',
        'focus-visible:shadow-[0_0_0_2px_var(--surface-panel),0_0_0_4px_var(--focus)]',
      )}
    >
      {/* Header: who, what, how long. The timer and the step count share
          one right edge, so the two rows read as one aligned block. */}
      <div className="flex items-center gap-3">
        <ProviderAvatar providerId={session.providerId} status={session.status} live={live} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {!done && (
              <StepIcon
                kind={waiting ? 'waiting' : currentKind}
                className={cn('shrink-0', waiting ? 'text-warn' : 'text-text-2')}
              />
            )}
            {/* The current step rolls when it changes: the old line leaves
                upward as the new one arrives, so the change is noticed
                without anything flashing. */}
            <div className="relative min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={headline}
                  initial={animate ? { y: 10, opacity: 0, filter: 'blur(2px)' } : false}
                  animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ y: -10, opacity: 0, filter: 'blur(2px)' }}
                  transition={{ duration: 0.24, ease: EASE }}
                  className="t-strong truncate text-text-1"
                >
                  {headline}
                </motion.p>
              </AnimatePresence>
            </div>
            <span className={cn('t-mono shrink-0', running ? 'text-text-1' : 'text-text-2')}>
              {timer}
            </span>
          </div>

          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-3">
            <p className="t-body min-w-0 truncate text-text-2">
              {session.project}
              {model && <span className="text-text-3"> · {model}</span>}
            </p>
            <StatusWord session={session} selected={selected} />
          </div>
        </div>
      </div>

      {/* Body: opens to its measured height. Motion cannot tween auto → auto,
          so the wrapper animates to a number and the inner div is measured. */}
      <motion.div
        initial={false}
        animate={{ height: selected ? bodyHeight || 'auto' : 0, opacity: selected ? 1 : 0 }}
        transition={
          animate
            ? {
                height: { duration: 0.32, ease: EASE },
                opacity: { duration: selected ? 0.22 : 0.12, delay: selected ? 0.06 : 0 },
              }
            : { duration: 0 }
        }
        className="overflow-hidden"
        aria-hidden={!selected}
      >
        <div ref={measureRef} className="pt-3.5">
          <Segments session={session} live={live} />
          <StepLog steps={session.steps} now={now} running={running} waiting={waiting} animate={animate} />
          {selected && <Actions session={session} />}
        </div>
      </motion.div>
    </div>
  );
});

function StatusWord({ session, selected }: { session: Session; selected: boolean }) {
  if (selected && session.steps.length > 0) {
    const n = session.steps.length;
    const done = session.status === 'completed';
    return (
      <span className="t-body shrink-0 text-text-2 tabular-nums">
        {done ? plural(n, 'step') : `Step ${n}`}
      </span>
    );
  }
  const map = {
    running: { word: 'Running', cls: 'text-text-2' },
    waiting: { word: 'Needs you', cls: 'text-warn' },
    completed: { word: 'Done', cls: 'text-text-3' },
    failed: { word: 'Failed', cls: 'text-error' },
  } as const;
  const { word, cls } = map[session.status];
  return <span className={cn('t-body shrink-0', cls)}>{word}</span>;
}

/**
 * One segment per step taken. There is deliberately no "of N": a live agent
 * has no known total, and inventing one would be the kind of fake precision
 * this product refuses. The open step carries a slow sweep instead of a
 * partial fill, because a partial fill would claim progress we cannot measure.
 */
function Segments({ session, live }: { session: Session; live: boolean }) {
  const cat = CATEGORIES[session.providerId];
  const steps = session.steps.slice(-MAX_SEGMENTS);
  if (steps.length === 0) return null;
  const open = session.status === 'running' || session.status === 'waiting';

  return (
    <div className="flex h-1 gap-1" aria-hidden="true">
      {steps.map((step, i) => {
        const isOpen = open && i === steps.length - 1;
        return (
          <div
            key={step.id}
            className={cn(
              'relative h-full flex-1 overflow-hidden rounded-full',
              isOpen ? 'bg-rule-strong' : cat.bg,
            )}
          >
            {isOpen && session.status === 'running' && (
              <span
                className={cn(
                  'acc-motion-loop absolute inset-y-0 left-0 w-2/5 rounded-full',
                  live && 'animate-[acc-sweep_1.6s_cubic-bezier(0.4,0,0.2,1)_infinite]',
                )}
                style={{
                  background: `linear-gradient(90deg, transparent, ${cat.color}, transparent)`,
                }}
              />
            )}
            {isOpen && session.status === 'waiting' && (
              <span className="absolute inset-0 rounded-full bg-warn opacity-70" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepLog({
  steps,
  now,
  running,
  waiting,
  animate,
}: {
  steps: SessionStep[];
  now: number;
  running: boolean;
  waiting: boolean;
  animate: boolean;
}) {
  const visible = steps.slice(-VISIBLE_STEPS);
  if (visible.length === 0) {
    return <p className="t-body mt-3 text-text-3">No steps recorded yet.</p>;
  }

  return (
    <ol className="mt-3 space-y-1.5">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((step, i) => {
          const isOpen = (running || waiting) && i === visible.length - 1 && step.durationMs === null;
          const duration =
            step.durationMs !== null
              ? formatDuration(step.durationMs)
              : running && isOpen
                ? formatDuration(now - step.startedAt)
                : null;
          return (
            <motion.li
              key={step.id}
              layout={animate ? 'position' : false}
              initial={animate ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
              transition={{ duration: 0.24, ease: EASE }}
              className="flex items-center gap-3"
            >
              <StepIcon
                kind={step.kind}
                className={cn(
                  'shrink-0',
                  isOpen && waiting ? 'text-warn' : isOpen ? 'text-text-3' : 'text-text-2',
                )}
              />
              <span
                className={cn(
                  't-body min-w-0 flex-1 truncate',
                  isOpen ? 'text-text-2' : 'text-text-1',
                )}
              >
                {step.label}
              </span>
              {duration && <span className="t-mono shrink-0 text-text-2">{duration}</span>}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

/**
 * Only actions that really work for this session. There is no Pause or
 * Approve: neither CLI accepts those from another process, so a waiting agent
 * is answered in its own terminal, and that is the primary action here.
 */
function Actions({ session }: { session: Session }) {
  const stopSession = useApp((s) => s.stopSession);
  const [confirmStop, setConfirmStop] = useState(false);
  const [copied, setCopied] = useState(false);
  const done = session.status === 'completed' || session.status === 'failed';
  const waiting = session.status === 'waiting';

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    void stopSession(session.providerId, session.id);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {!done && session.projectPath && (
        <PillButton
          primary={waiting}
          onClick={() => void openTerminal(session.projectPath)}
          icon={<SquareTerminal size={15} strokeWidth={1.9} />}
        >
          {waiting ? 'Respond in terminal' : 'Open terminal'}
        </PillButton>
      )}

      {!done && session.stoppable && (
        <PillButton
          danger={confirmStop}
          onClick={stop}
          onBlur={() => setConfirmStop(false)}
          icon={<Square size={13} strokeWidth={2.2} />}
        >
          {confirmStop ? 'Click again to stop' : 'Stop'}
        </PillButton>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void copySessionInfo(session).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          aria-label="Copy session details"
          title="Copy session details"
          className="grid size-8 place-items-center rounded-full text-text-2 transition-colors duration-100 hover:bg-card-hover hover:text-text-1"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? 'done' : 'copy'}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.12 }}
              className="grid place-items-center"
            >
              {copied ? (
                <span className="t-caption text-ok">Copied</span>
              ) : (
                <Copy size={14} strokeWidth={1.9} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
        {session.projectPath && (
          <button
            type="button"
            onClick={() => void openProject(session.projectPath)}
            className="t-label flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-text-2 transition-colors duration-100 hover:bg-card-hover hover:text-text-1"
          >
            Open project
            <ArrowUpRight size={14} strokeWidth={1.9} />
          </button>
        )}
      </div>
    </div>
  );
}

function PillButton({
  children,
  icon,
  onClick,
  onBlur,
  primary = false,
  danger = false,
}: {
  children: string;
  icon: ReactNode;
  onClick: (e: MouseEvent) => void;
  onBlur?: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={onBlur}
      className={cn(
        't-label flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5',
        'transition-[background-color,color,border-color,transform] duration-100 ease-out active:scale-[0.97]',
        primary
          ? 'bg-primary text-primary-fg hover:bg-primary-hover'
          : danger
            ? 'border border-error/60 text-error'
            : 'border border-rule-strong text-text-1 hover:bg-card-hover',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
