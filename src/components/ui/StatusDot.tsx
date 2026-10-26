import { cn } from '@/lib/cn';
import type { ProviderStatus, SessionStatus } from '@/types/domain';

export type Tone = 'ok' | 'idle' | 'warn' | 'error' | 'accent';


const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok',
  idle: 'bg-idle',
  warn: 'bg-warn',
  error: 'bg-error',
  accent: 'bg-focus',
};

export const PROVIDER_TONE: Record<ProviderStatus, Tone> = {
  active: 'ok',
  idle: 'idle',
  offline: 'idle',
  error: 'error',
};

export const PROVIDER_WORD: Record<ProviderStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  offline: 'Offline',
  error: 'Error',
};

export const SESSION_TONE: Record<SessionStatus, Tone> = {
  running: 'ok',
  waiting: 'warn',
  completed: 'idle',
  failed: 'error',
};

export const SESSION_WORD: Record<SessionStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Done',
  failed: 'Failed',
};

interface StatusDotProps {
  tone: Tone;
  /** Draws a soft ring for a live state. Used only for 'running'/'active'. */
  live?: boolean;
  className?: string;
}

/**
 * A 6px drawn dot. Status is never carried by the dot alone — every caller
 * pairs it with a word, so the state survives a colorblind reading and a
 * grayscale screenshot.
 */
export function StatusDot({ tone, live = false, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex size-1.5 shrink-0', className)}
    >
      {live && (
        <span
          className={cn(
            'absolute -inset-[3px] rounded-full opacity-25',
            TONE_CLASS[tone],
          )}
        />
      )}
      <span className={cn('relative size-1.5 rounded-full', TONE_CLASS[tone])} />
    </span>
  );
}
