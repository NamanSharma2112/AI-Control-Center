import { memo } from 'react';
import type { UsageHistoryPoint } from '@/types/domain';
import { cn } from '@/lib/cn';

/**
 * Seven days of activity as a small column plot in an inset well.
 *
 * Deliberately not a chart library and deliberately not axis-labelled: the
 * question it answers is "is today busier than usual", which a shape answers
 * faster than numbers. Today's column is accented so the comparison has an
 * anchor.
 */
/** Column height in px. Tall enough to show a shape, short enough to glance. */
const PLOT_HEIGHT = 38;

export const UsageHistory = memo(function UsageHistory({
  history,
  animate,
}: {
  history: UsageHistoryPoint[];
  animate: boolean;
}) {
  const peak = Math.max(1, ...history.map((h) => h.total));

  return (
    <div className="px-3.5 pb-3">
      <div className="flex items-end gap-1.5 rounded-md bg-surface-inset px-2.5 pt-2.5 pb-2 inset-ring inset-ring-rule">
        {history.map((point, i) => {
          const isToday = i === history.length - 1;
          const ratio = point.total / peak;
          // A day with activity never renders as nothing, and an empty day
          // keeps a baseline so the week still reads as seven slots.
          const height = point.total === 0 ? 1 : Math.max(3, Math.round(ratio * PLOT_HEIGHT));
          return (
            <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="sr-only">
                {point.label}: {point.total} activities
              </span>
              <div className="flex w-full items-end justify-center" style={{ height: PLOT_HEIGHT }}>
                <div
                  className={cn(
                    'w-full max-w-[14px] rounded-[1.5px]',
                    isToday ? 'bg-accent' : 'bg-rule-strong',
                    point.total === 0 && 'bg-rule',
                    animate && 'transition-[height] duration-[420ms] ease-out-expo',
                  )}
                  style={{ height: `${height}px` }}
                />
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  't-meta tabular-nums',
                  isToday ? 'text-text-2' : 'text-text-3',
                )}
              >
                {point.label.slice(0, 2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
