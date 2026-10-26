import { memo } from 'react';
import type { DaySummary } from '@/types/domain';
import { PROVIDER_NAMES } from '@/providers/registry';
import { ProvenanceTag } from '@/components/ui/ProvenanceTag';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

/**
 * The day's rollup. One number and the split behind it — enough to know
 * whether today has been busy and who did the work, and no more. The count
 * is the only large numeral in the panel.
 */
export const TodaySummary = memo(function TodaySummary({
  today,
  animate,
}: {
  today: DaySummary;
  animate: boolean;
}) {
  const count = useAnimatedNumber(today.totalActivities, animate);

  return (
    <div className="flex items-end justify-between gap-3 px-3.5 pb-3">
      <div className="flex items-baseline gap-1.5">
        <span className="t-display text-text-1 tabular-nums">
          {Math.round(count)}
        </span>
        <span className="t-label text-text-2">
          {today.totalActivities === 1 ? 'AI activity' : 'AI activities'}
        </span>
        <ProvenanceTag source={today.source} />
      </div>

      {today.byProvider.length > 0 && (
        <dl className="flex items-baseline gap-3">
          {today.byProvider.map(({ providerId, share }) => (
            <div key={providerId} className="flex items-baseline gap-1">
              <dt className="t-meta text-text-3">
                {PROVIDER_NAMES[providerId].split(' ')[0]}
              </dt>
              <dd className="t-mono text-text-2">{share}%</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
});
