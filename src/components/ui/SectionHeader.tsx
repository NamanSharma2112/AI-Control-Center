import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The only uppercase in the system. More space above than below, so the
 * header binds to the content it introduces rather than floating between
 * two groups.
 */
export function SectionHeader({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 px-3.5 pt-3.5 pb-2',
        className,
      )}
    >
      <h2 className="t-section text-text-3">{children}</h2>
      {trailing ? <div className="flex items-center gap-1.5">{trailing}</div> : null}
    </div>
  );
}

/** The hairline that separates two sections. */
export function Rule({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-rule', className)} />;
}
