import { cn } from '@/lib/cn';
import type { DataSource } from '@/types/domain';

const WORD: Record<DataSource, string> = {
  provider: '',
  local: 'local',
  estimated: 'est.',
};

const TITLE: Record<DataSource, string> = {
  provider: 'Reported by the provider',
  local: 'Counted from local state on this machine, not reported by the provider',
  estimated: 'Estimated locally, not reported by the provider',
};

/**
 * Renders the provenance of a number inline, in tertiary text.
 *
 * A provider-reported figure needs no mark — that is the baseline. Anything
 * the app worked out itself says so, every time it is shown. This is the
 * cheapest possible honesty and it is non-negotiable (see PRODUCT.md).
 */
export function ProvenanceTag({
  source,
  className,
}: {
  source: DataSource;
  className?: string;
}) {
  if (source === 'provider') return null;
  return (
    <span
      title={TITLE[source]}
      className={cn('t-caption text-text-3', className)}
    >
      {WORD[source]}
    </span>
  );
}
