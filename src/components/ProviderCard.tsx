import { memo } from 'react';
import type { Limit, ProviderSnapshot } from '@/types/domain';
import { Meter } from '@/components/ui/Meter';
import {
  PROVIDER_TONE,
  PROVIDER_WORD,
  StatusDot,
  type Tone,
} from '@/components/ui/StatusDot';
import { ProvenanceTag } from '@/components/ui/ProvenanceTag';
import { formatCountdown } from '@/lib/time';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

interface ProviderCardProps {
  snapshot: ProviderSnapshot;
  animate: boolean;
  now: number;
}

/**
 * One provider, as a faceplate row rather than a card: hairlines and spacing
 * do the containing. Reads top-to-bottom as name + state, then the meter,
 * then what is left and when it comes back.
 */
export const ProviderCard = memo(function ProviderCard({
  snapshot,
  animate,
  now,
}: ProviderCardProps) {
  const { provider, usage, limits, sessions } = snapshot;
  const activeCount = sessions.filter(
    (s) => s.status === 'running' || s.status === 'waiting',
  ).length;

  const remaining = usage ? 100 - usage.percentage : null;
  const tone = remaining === null ? 'idle' : meterTone(remaining);
  const shownRemaining = useAnimatedNumber(remaining ?? 0, animate && remaining !== null);
  const reset = primaryReset(limits, usage?.resetAt ?? null);

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot
            tone={PROVIDER_TONE[provider.status]}
            live={provider.status === 'active'}
          />
          <span className="t-value truncate text-text-1">{provider.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeCount > 0 && (
            <span className="t-meta text-text-3">
              {activeCount} {activeCount === 1 ? 'session' : 'sessions'}
            </span>
          )}
          <span className="t-label text-text-2">{PROVIDER_WORD[provider.status]}</span>
        </div>
      </div>

      {usage && remaining !== null ? (
        <>
          <div className="mt-2.5">
            {/* The meter reads what is left, so the bar and the number
                always say the same thing and the bar shrinks as it is spent. */}
            <Meter
              value={remaining}
              tone={tone}
              animate={animate}
              label={`${provider.name} usage remaining`}
            />
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="t-value text-text-1 tabular-nums">
                {Math.round(shownRemaining)}%
              </span>
              <span className="t-label text-text-2">remaining</span>
              <ProvenanceTag source={usage.source} />
            </div>
            {reset && (
              <span className="t-meta text-text-3">
                {reset.window === 'weekly' ? 'Weekly reset' : 'Resets'}{' '}
                <span className="text-text-2">
                  {reset.resetAt ? formatCountdown(reset.resetAt, now) : reset.resetLabel}
                </span>
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="t-meta mt-2 text-text-3">
          {provider.connected
            ? provider.statusDetail ?? 'No usage reported by this provider.'
            : 'Not connected.'}
        </p>
      )}
    </div>
  );
});

function meterTone(remaining: number): Tone {
  if (remaining <= 10) return 'error';
  if (remaining <= 25) return 'warn';
  return 'ok';
}

function primaryReset(limits: Limit[], fallbackResetAt: number | null): Limit | null {
  if (limits.length > 0) {
    const next = [...limits].sort(
      (a, b) => (a.resetAt ?? Infinity) - (b.resetAt ?? Infinity),
    );
    return next[0];
  }
  if (fallbackResetAt === null) return null;
  return {
    providerId: 'codex',
    window: 'session',
    cap: null,
    resetAt: fallbackResetAt,
    resetLabel: 'Rolling window',
    source: 'local',
  };
}
