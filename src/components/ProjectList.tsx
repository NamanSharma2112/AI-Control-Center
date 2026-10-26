import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Project } from '@/types/domain';
import { formatRelative } from '@/lib/time';
import { openProject } from '@/lib/actions';
import { Empty } from './ActivityList';
import { cn } from '@/lib/cn';

/**
 * Where the week's agent work went. Shares are of locally counted activity,
 * which the header of this tab says, so the percentages are never read as
 * spend or tokens.
 */
export const ProjectList = memo(function ProjectList({
  projects,
  animate,
}: {
  projects: Project[];
  animate: boolean;
}) {
  if (projects.length === 0) {
    return <Empty>No project activity recorded yet.</Empty>;
  }

  return (
    <div>
      <p className="t-caption mb-2 px-1 text-text-3">Share of agent activity this week · local</p>
      <ul className="space-y-1">
        {projects.map((p, i) => {
          const other = p.id === '__other__';
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!p.path}
                onClick={() => p.path && void openProject(p.path)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
                  'transition-colors duration-100 enabled:hover:bg-card',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn('t-label truncate', other ? 'text-text-2' : 'text-text-1')}>
                      {p.name}
                    </span>
                    <span className="t-mono shrink-0 text-text-1">{p.share}%</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-rule">
                    <div
                      className={cn('h-full rounded-full', other ? 'bg-rule-strong' : 'bg-text-2')}
                      style={{
                        width: `${p.share}%`,
                        animation: animate
                          ? `acc-reveal 600ms var(--ease-out-expo) ${120 + i * 40}ms both`
                          : undefined,
                      }}
                    />
                  </div>
                  <p className="t-caption mt-1 text-text-3">
                    {p.activityCount} {p.activityCount === 1 ? 'action' : 'actions'} · last{' '}
                    {formatRelative(p.lastActiveAt)}
                  </p>
                </div>
                {p.path && (
                  <ArrowUpRight
                    size={15}
                    strokeWidth={1.9}
                    className="shrink-0 text-text-3 opacity-0 transition-opacity duration-100 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
