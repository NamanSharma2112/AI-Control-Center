import { memo } from 'react';
import type { Activity, ActivityType } from '@/types/domain';
import { PROVIDER_NAMES } from '@/providers/registry';
import { formatClock } from '@/lib/time';
import { cn } from '@/lib/cn';

/** How each activity type reads in the feed, in the product's own voice. */
const TYPE_TONE: Record<ActivityType, 'neutral' | 'ok' | 'warn' | 'error'> = {
  'session-started': 'neutral',
  'session-completed': 'ok',
  'session-failed': 'error',
  'task-completed': 'ok',
  'file-edited': 'neutral',
  'command-run': 'neutral',
  'usage-threshold': 'warn',
  'connection-lost': 'error',
};

const TONE_CLASS = {
  neutral: 'bg-rule-strong',
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
} as const;

/**
 * The timeline: time on the left in mono so the column aligns, a 1px spine,
 * and one line per event. No icons per row — at this density an icon column
 * would be noise, and the tick on the spine already carries the tone.
 */
export const Timeline = memo(function Timeline({
  activities,
  max = 8,
}: {
  activities: Activity[];
  max?: number;
}) {
  const shown = activities.slice(0, max);

  if (shown.length === 0) {
    return (
      <p className="t-meta px-3.5 pb-3 text-text-3">Nothing recorded yet today.</p>
    );
  }

  return (
    <ol className="relative px-3.5 pb-1">
      {/* The spine sits under the ticks, inset to the mono column's edge. */}
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-2 left-[3.55rem] w-px bg-rule"
      />
      {shown.map((activity) => (
        <li key={activity.id} className="relative flex items-baseline gap-2 py-[3px]">
          <time
            dateTime={new Date(activity.timestamp).toISOString()}
            className="t-mono w-[3.1rem] shrink-0 whitespace-nowrap text-right text-text-3"
          >
            {formatClock(activity.timestamp)}
          </time>
          <span
            aria-hidden="true"
            className={cn(
              'relative z-10 mt-[-1px] size-1 shrink-0 rounded-full ring-2 ring-surface-1',
              TONE_CLASS[TYPE_TONE[activity.type]],
            )}
          />
          <p className="t-body min-w-0 flex-1 truncate text-text-2">
            <span className="text-text-1">{activity.message}</span>
            {activity.project && (
              <span className="text-text-3"> · {activity.project}</span>
            )}
          </p>
          <span className="t-meta shrink-0 text-text-3">
            {PROVIDER_NAMES[activity.providerId].split(' ')[0]}
          </span>
        </li>
      ))}
    </ol>
  );
});
