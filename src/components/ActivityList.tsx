import { memo, useMemo } from 'react';
import { motion } from 'motion/react';
import type { Activity, ActivityType } from '@/types/domain';
import { CATEGORIES } from '@/lib/categories';
import { formatClock, localDateKey, DAY } from '@/lib/time';
import { cn } from '@/lib/cn';

/** Success is the normal case and stays quiet; only problems take color. */
const TONE: Partial<Record<ActivityType, string>> = {
  'session-failed': 'text-error',
  'connection-lost': 'text-error',
  'usage-threshold': 'text-warn',
};

/**
 * What happened recently, newest first, grouped by day. Time sits in a mono
 * column so the eye can run down it; the provider is a colored dot rather
 * than a word, because the colors are already learned from the cards.
 */
export const ActivityList = memo(function ActivityList({
  activities,
  animate,
}: {
  activities: Activity[];
  animate: boolean;
}) {
  const groups = useMemo(() => groupByDay(activities.slice(0, 40)), [activities]);

  if (groups.length === 0) {
    return <Empty>Nothing recorded yet. Activity appears here as agents work.</Empty>;
  }

  let index = 0;
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h4 className="t-caption mb-1 px-1 text-text-3">{group.label}</h4>
          <ol>
            {group.items.map((a) => {
              const cat = CATEGORIES[a.providerId];
              const i = index++;
              return (
                <motion.li
                  key={a.id}
                  initial={animate && i < 10 ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: animate ? Math.min(i, 9) * 0.025 : 0, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors duration-100 hover:bg-card"
                >
                  <time className="t-mono w-[4.5rem] shrink-0 text-text-3" dateTime={new Date(a.timestamp).toISOString()}>
                    {formatClock(a.timestamp)}
                  </time>
                  <span className={cn('size-1.5 shrink-0 rounded-full', cat.bg)} title={cat.label} />
                  <span className={cn('t-body min-w-0 flex-1 truncate text-text-1', TONE[a.type])}>
                    {a.message}
                  </span>
                  {a.project && (
                    <span className="t-body max-w-[38%] shrink-0 truncate text-text-3">{a.project}</span>
                  )}
                </motion.li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
});

function groupByDay(activities: Activity[]) {
  const today = localDateKey(Date.now());
  const yesterday = localDateKey(Date.now() - DAY);
  const groups: Array<{ key: string; label: string; items: Activity[] }> = [];
  for (const a of activities) {
    const key = localDateKey(a.timestamp);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : new Date(a.timestamp).toLocaleDateString(undefined, { weekday: 'long' });
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(a);
  }
  return groups;
}

export function Empty({ children }: { children: string }) {
  return (
    <div className="grid h-full min-h-32 place-items-center rounded-lg border border-dashed border-rule-strong px-6 text-center">
      <p className="t-body max-w-[32ch] text-text-2">{children}</p>
    </div>
  );
}
