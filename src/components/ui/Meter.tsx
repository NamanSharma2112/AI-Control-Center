import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import type { Tone } from './StatusDot';

const FILL_CLASS: Record<Tone, string> = {
  ok: 'bg-ok',
  idle: 'bg-idle',
  warn: 'bg-warn',
  error: 'bg-error',
  accent: 'bg-accent',
};

interface MeterProps {
  /** 0–100, the share consumed. */
  value: number;
  tone: Tone;
  /** Tween the fill on mount. Off for reduced motion and for list rows. */
  animate?: boolean;
  /** Ticks per decade. The calibration is what makes this a scale. */
  ticks?: number;
  className?: string;
  label: string;
}

/**
 * A calibrated meter: an inset channel with a tick every 10%, filled from the
 * left. The ticks are the point — they turn a progress bar into a scale you
 * can read a value off without the number, which is what an instrument does.
 */
export function Meter({
  value,
  tone,
  animate = true,
  ticks = 10,
  className,
  label,
}: MeterProps) {
  const shown = useAnimatedNumber(clamp(value), animate);

  const tickMarks = useMemo(
    () =>
      Array.from({ length: ticks - 1 }, (_, i) => ((i + 1) / ticks) * 100),
    [ticks],
  );

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamp(value))}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-surface-inset',
        'inset-ring inset-ring-rule',
        className,
      )}
    >
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full', FILL_CLASS[tone])}
        style={{ width: `${clamp(shown)}%` }}
      />
      {/* Calibration ticks sit above the fill so the scale stays readable. */}
      <div aria-hidden="true" className="absolute inset-0">
        {tickMarks.map((left) => (
          <span
            key={left}
            className="absolute top-0 h-full w-px bg-tick"
            style={{ left: `${left}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}
