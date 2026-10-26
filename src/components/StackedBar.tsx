import { memo } from 'react';
import type { ProviderShare } from '@/lib/insights';
import { CATEGORIES, type CategoryId } from '@/lib/categories';
import { cn } from '@/lib/cn';

/**
 * The week split by provider: one bar, one segment per provider, with a gap
 * between segments so each reads as its own quantity. Segment colors are the
 * card colors, so the split and the cards explain each other.
 */
export const StackedBar = memo(function StackedBar({
  shares,
  focus,
  onFocus,
  animate,
}: {
  shares: ProviderShare[];
  focus: CategoryId | null;
  onFocus: (id: CategoryId | null) => void;
  animate: boolean;
}) {
  const total = shares.reduce((sum, s) => sum + s.count, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-body text-text-2">Activity this week</span>
        <span className="t-body text-text-2">
          <span className="t-strong text-text-1 tabular-nums">{total.toLocaleString()}</span>{' '}
          {total === 1 ? 'action' : 'actions'}
        </span>
      </div>

      <div
        className="mt-2.5 flex h-2 w-full gap-1 overflow-hidden rounded-full"
        // The calibration on open: the bar reveals left to right once, as one
        // quantity filling, then only moves when the data does.
        style={animate ? { animation: 'acc-reveal 700ms var(--ease-out-expo) 120ms both' } : undefined}
        role="img"
        aria-label={shares.map((s) => `${s.name} ${s.count}`).join(', ')}
      >
        {total === 0 ? (
          <div className="h-full w-full rounded-full bg-rule" />
        ) : (
          shares.map((s) => {
            const cat = CATEGORIES[s.providerId];
            return (
              <div
                key={s.providerId}
                onPointerEnter={() => onFocus(s.providerId)}
                onPointerLeave={() => onFocus(null)}
                className={cn(
                  'h-full rounded-full first:rounded-l-full',
                  cat.bg,
                  'transition-[opacity,flex-grow] duration-300 ease-out-expo',
                  focus && focus !== s.providerId ? 'opacity-30' : 'opacity-100',
                )}
                style={{ flexGrow: s.count, flexBasis: 0 }}
              />
            );
          })
        )}
      </div>

      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {shares.map((s) => {
          const cat = CATEGORIES[s.providerId];
          return (
            <li key={s.providerId}>
              <button
                type="button"
                onPointerEnter={() => onFocus(s.providerId)}
                onPointerLeave={() => onFocus(null)}
                onFocus={() => onFocus(s.providerId)}
                onBlur={() => onFocus(null)}
                className={cn(
                  't-body flex items-center gap-1.5 rounded-sm transition-opacity duration-150',
                  focus && focus !== s.providerId ? 'opacity-45' : 'opacity-100',
                )}
              >
                <span className={cn('size-1.5 rounded-full', cat.bg)} aria-hidden="true" />
                <span className="text-text-2">{s.name}</span>
                <span className="t-label text-text-1 tabular-nums">{s.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
