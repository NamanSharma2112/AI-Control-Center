import { memo } from 'react';
import type { Project } from '@/types/domain';
import { cn } from '@/lib/cn';

/**
 * Where the activity went. A share bar behind the row rather than beside it,
 * so four projects read as one comparable set without four separate meters
 * competing with the provider meters above.
 */
export const ProjectBreakdown = memo(function ProjectBreakdown({
  projects,
  animate,
}: {
  projects: Project[];
  animate: boolean;
}) {
  if (projects.length === 0) {
    return <p className="t-meta px-3.5 pb-3 text-text-3">No project activity recorded.</p>;
  }

  return (
    <ul className="px-3.5 pb-3">
      {projects.map((project) => (
        <li key={project.id} className="py-[3px]">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                't-body truncate',
                project.id === '__other__' ? 'text-text-3' : 'text-text-1',
              )}
            >
              {project.name}
            </span>
            <span className="t-mono shrink-0 text-text-2">{project.share}%</span>
          </div>
          {/* The share reads as a measured underline rather than a filled
              block: a second row of pills would fight the provider meters. */}
          <div className="mt-1 h-px w-full bg-rule">
            <div
              aria-hidden="true"
              className={cn(
                'h-px',
                project.id === '__other__' ? 'bg-rule-strong' : 'bg-text-3',
                animate && 'transition-[width] duration-[420ms] ease-out-expo',
              )}
              style={{ width: `${project.share}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
});
