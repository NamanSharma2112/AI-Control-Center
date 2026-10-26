import { memo, useState } from 'react';
import { ClipboardCopy, FolderOpen, Square, SquareTerminal } from 'lucide-react';
import type { Session } from '@/types/domain';
import { SESSION_TONE, SESSION_WORD, StatusDot } from '@/components/ui/StatusDot';
import { IconButton } from '@/components/ui/IconButton';
import { PROVIDER_NAMES } from '@/providers/registry';
import { formatElapsed } from '@/lib/time';
import { copySessionInfo, openProject, openTerminal } from '@/lib/actions';
import { useApp } from '@/store/app';
import { cn } from '@/lib/cn';

interface SessionRowProps {
  session: Session;
  now: number;
}

/**
 * An active agent, answering "what is this one doing right now" in one line:
 * provider, project, current activity, and how long it has been at it.
 *
 * Controls appear on hover or keyboard focus so the resting row stays a clean
 * data line. Stopping a task is destructive, so it takes a second click.
 */
export const SessionRow = memo(function SessionRow({ session, now }: SessionRowProps) {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const stopSession = useApp((s) => s.stopSession);

  return (
    <div
      className={cn(
        'group/row relative flex items-start gap-2 px-3.5 py-2',
        'transition-colors duration-[90ms] hover:bg-surface-2 focus-within:bg-surface-2',
      )}
      onMouseLeave={() => setConfirmingStop(false)}
    >
      <StatusDot
        tone={SESSION_TONE[session.status]}
        live={session.status === 'running'}
        className="mt-[5px]"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="t-label shrink-0 text-text-2">
            {PROVIDER_NAMES[session.providerId]}
          </span>
          <span className="t-body truncate font-medium text-text-1">
            {session.project}
          </span>
        </div>
        <p className="t-meta mt-0.5 truncate text-text-2">{session.currentActivity}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* Controls replace the timer on hover, so the row never grows. */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-[90ms] group-hover/row:opacity-100 focus-within:opacity-100">
          {session.projectPath && (
            <>
              <IconButton
                icon={FolderOpen}
                label={`Open ${session.project}`}
                onClick={() => void openProject(session.projectPath)}
              />
              <IconButton
                icon={SquareTerminal}
                label={`Open terminal in ${session.project}`}
                onClick={() => void openTerminal(session.projectPath)}
              />
            </>
          )}
          <IconButton
            icon={ClipboardCopy}
            label="Copy session info"
            onClick={() => void copySessionInfo(session)}
          />
          {session.stoppable && (
            <IconButton
              icon={Square}
              tone="danger"
              label={confirmingStop ? 'Click again to stop this task' : 'Stop task'}
              onClick={() => {
                if (!confirmingStop) {
                  setConfirmingStop(true);
                  return;
                }
                setConfirmingStop(false);
                void stopSession(session.providerId, session.id);
              }}
              className={confirmingStop ? 'bg-error-well text-error' : undefined}
            />
          )}
        </div>

        <div className="flex flex-col items-end group-hover/row:hidden">
          <span className="t-mono text-text-1">
            {formatElapsed(session.startedAt, now)}
          </span>
          <span className="t-meta text-text-3">{SESSION_WORD[session.status]}</span>
        </div>
      </div>
    </div>
  );
});
