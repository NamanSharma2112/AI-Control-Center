import { Check, X } from 'lucide-react';
import type { ProviderId, SessionStatus } from '@/types/domain';
import { CATEGORIES } from '@/lib/categories';
import { cn } from '@/lib/cn';

/**
 * Who is working, and whether they are working right now.
 *
 * Running: a short arc in the provider's color circles the glyph — the only
 * loop on the card, and it stops the moment the agent does. Waiting: a badge
 * that reads "this one needs you". Done and failed replace the glyph with the
 * outcome, because once a session ends the outcome is what matters.
 */
export function ProviderAvatar({
  providerId,
  status,
  live,
  needsYou = status === 'waiting',
}: {
  providerId: ProviderId;
  status: SessionStatus;
  /** Whether loops may run (panel visible, motion allowed). */
  live: boolean;
  /** Waiting on the user specifically, rather than merely idle. */
  needsYou?: boolean;
}) {
  const cat = CATEGORIES[providerId];
  const Icon = cat.icon;

  if (status === 'completed') {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] text-ok">
        <Check size={15} strokeWidth={2.4} aria-hidden="true" />
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--error)_16%,transparent)] text-error">
        <X size={15} strokeWidth={2.4} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="relative grid size-7 shrink-0 place-items-center">
      <span className="absolute inset-0 rounded-full bg-card-hover" />
      {status === 'running' && (
        <svg
          viewBox="0 0 28 28"
          className={cn('acc-motion-loop absolute inset-0', live && 'animate-[acc-spin_1.1s_linear_infinite]')}
          aria-hidden="true"
        >
          <circle
            cx="14"
            cy="14"
            r="12.75"
            fill="none"
            stroke={cat.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="20 80"
            pathLength="100"
          />
        </svg>
      )}
      <Icon size={14} strokeWidth={2.2} className={cn('relative', cat.text)} aria-hidden="true" />
      {needsYou && (
        <span className="absolute -top-px -right-px size-2.5 rounded-full border-2 border-panel bg-warn" />
      )}
    </span>
  );
}
