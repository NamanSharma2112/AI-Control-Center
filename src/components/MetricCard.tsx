import { memo, type ReactNode } from 'react';
import { MiniChart, type ChartForm } from '@/components/charts/MiniChart';
import type { SeriesPoint } from '@/lib/insights';
import type { Category } from '@/lib/categories';
import { cn } from '@/lib/cn';

interface MetricCardProps {
  category: Category;
  /** Optional state word after the label: "Active", "Idle". */
  status?: string;
  figure: ReactNode;
  unit: ReactNode;
  detail: ReactNode;
  series: SeriesPoint[];
  form: ChartForm;
  chartUnit: string;
  animate: boolean;
  /** Another part of the panel is pointing at this card. */
  highlighted: boolean;
  /** Another category is highlighted, so this one steps back. */
  dimmed: boolean;
  onHoverChange: (hovering: boolean) => void;
}

/**
 * One category: label and figure on the left, its week on the right.
 *
 * Hovering a card tells the panel, which lights the matching stacked-bar
 * segment and legend item; the reverse also works. The card itself only ever
 * changes background and opacity — it never moves, so the column stays still
 * under the pointer.
 */
export const MetricCard = memo(function MetricCard({
  category,
  status,
  figure,
  unit,
  detail,
  series,
  form,
  chartUnit,
  animate,
  highlighted,
  dimmed,
  onHoverChange,
}: MetricCardProps) {
  const Icon = category.icon;

  return (
    <section
      aria-label={category.label}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      className={cn(
        'grid flex-1 grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] gap-3 rounded-lg p-4 pr-3 @min-[720px]:min-h-0',
        'transition-[background-color,opacity] duration-150 ease-out',
        highlighted ? 'bg-card-hover' : 'bg-card',
        dimmed && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-col justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={14} strokeWidth={2} className={cn('shrink-0', category.text)} />
          <h3 className={cn('t-label truncate', category.text)}>{category.label}</h3>
          {status && (
            <span className="t-caption hidden shrink-0 text-text-3 @min-[480px]:inline">{status}</span>
          )}
        </div>

        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="t-figure text-text-1">{figure}</span>
            <span className="t-body text-text-2">{unit}</span>
          </p>
          <div className="t-body mt-0.5 truncate text-text-2">{detail}</div>
        </div>
      </div>

      <div className="flex min-w-0 items-end">
        <MiniChart
          series={series}
          form={form}
          color={category.color}
          unit={chartUnit}
          animate={animate}
        />
      </div>
    </section>
  );
});
