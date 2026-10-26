import { memo, useId, useMemo, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { SeriesPoint } from '@/lib/insights';
import { useMeasure } from '@/hooks/useMeasure';
import { cn } from '@/lib/cn';

export type ChartForm = 'bars' | 'area' | 'lollipop';

interface MiniChartProps {
  series: SeriesPoint[];
  form: ChartForm;
  /** CSS color for marks. */
  color: string;
  /** Unit word for the tooltip: "actions", "sessions". */
  unit: string;
  /** Play the draw-in. Off for reduced motion and keyboard-summoned opens. */
  animate: boolean;
  height?: number;
}

const PAD = { top: 10, right: 4, bottom: 20, left: 28 };
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * A seven-day chart drawn to scale.
 *
 * The y-axis carries three ticks (0, middle, top) on a rounded scale so the
 * labels name values the chart actually reaches. Marks draw in once when the
 * panel opens: bars and stems rise from the baseline, the line draws along its
 * length. After that, data changes simply re-render — a chart that re-animates
 * on every refresh is performing rather than informing.
 */
export const MiniChart = memo(function MiniChart({
  series,
  form,
  color,
  unit,
  animate,
  height = 148,
}: MiniChartProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const top = useMemo(() => niceTop(Math.max(0, ...series.map((p) => p.value))), [series]);
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const n = series.length;
  const step = n > 0 ? innerW / n : 0;
  const x = (i: number) => PAD.left + step * i + step / 2;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const baseline = PAD.top + innerH;

  const linePath = useMemo(() => {
    if (form !== 'area' || n === 0 || width === 0) return '';
    return series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
    // x and y are pure functions of these inputs.
  }, [form, series, width, top, height]);

  const areaPath = linePath
    ? `${linePath} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`
    : '';

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (step === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.left) / step);
    setHover(i >= 0 && i < n ? i : null);
  };

  const ticks = [top, top / 2, 0];
  const barW = Math.min(16, step * 0.52);
  const active = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${unit} per day, last 7 days: ${series
            .map((p) => `${p.day} ${p.value}`)
            .join(', ')}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>

          {/* Scale */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--grid)"
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : '2 3'}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="t-caption"
                fill="var(--text-3)"
              >
                {formatTick(t)}
              </text>
            </g>
          ))}

          {series.map((p, i) => (
            <text
              key={`${p.day}-${i}`}
              x={x(i)}
              y={height - 4}
              textAnchor="middle"
              className="t-caption"
              fill={hover === i || (hover === null && p.isToday) ? 'var(--text-2)' : 'var(--text-3)'}
            >
              {p.label}
            </text>
          ))}

          {/* Hover column */}
          {hover !== null && (
            <rect
              x={PAD.left + step * hover + 1}
              y={PAD.top}
              width={Math.max(0, step - 2)}
              height={innerH}
              rx={5}
              fill="var(--text-1)"
              opacity={0.04}
            />
          )}

          {form === 'bars' &&
            series.map((p, i) => {
              const h = Math.max(p.value > 0 ? 3 : 0, baseline - y(p.value));
              return (
                <motion.rect
                  key={`${p.day}-${i}`}
                  x={x(i) - barW / 2}
                  y={baseline - h}
                  width={barW}
                  height={h}
                  rx={Math.min(3, barW / 2)}
                  fill={color}
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  initial={animate ? { scaleY: 0 } : false}
                  animate={{ scaleY: 1, opacity: hover === null || hover === i ? 1 : 0.45 }}
                  transition={{
                    scaleY: { duration: 0.55, ease: EASE, delay: animate ? 0.12 + i * 0.035 : 0 },
                    opacity: { duration: 0.12 },
                  }}
                />
              );
            })}

          {form === 'area' && linePath && (
            <>
              <motion.path
                d={areaPath}
                fill={`url(#${gradientId})`}
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: animate ? 0.35 : 0 }}
              />
              <motion.path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={animate ? { pathLength: 0 } : false}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.7, ease: EASE, delay: animate ? 0.12 : 0 }}
              />
              {series.map((p, i) => (
                <motion.circle
                  key={`${p.day}-${i}`}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={hover === i ? 4.5 : 3}
                  fill={color}
                  stroke="var(--surface-card)"
                  strokeWidth={hover === i ? 2 : 0}
                  initial={animate ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: animate ? 0.12 + (i / n) * 0.7 : 0 }}
                />
              ))}
            </>
          )}

          {form === 'lollipop' &&
            series.map((p, i) => (
              <g key={`${p.day}-${i}`} opacity={hover === null || hover === i ? 1 : 0.45}>
                <motion.line
                  x1={x(i)}
                  x2={x(i)}
                  y1={baseline}
                  y2={y(p.value)}
                  stroke={color}
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  initial={animate ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.45, ease: EASE, delay: animate ? 0.12 + i * 0.035 : 0 }}
                />
                <motion.circle
                  cx={x(i)}
                  cy={y(p.value)}
                  r={hover === i ? 5.5 : 4.5}
                  fill={color}
                  initial={animate ? { opacity: 0, scale: 0.6 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}
                  transition={{ duration: 0.3, ease: EASE, delay: animate ? 0.4 + i * 0.035 : 0 }}
                />
              </g>
            ))}

          {/* Guide from the hovered point down to the baseline. */}
          {form === 'area' && hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={baseline}
              stroke={color}
              strokeOpacity={0.35}
              strokeDasharray="2 3"
            />
          )}
        </svg>
      )}

      <AnimatePresence>
        {active && hover !== null && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.12, ease: EASE }}
            className={cn(
              'pointer-events-none absolute z-10 -translate-x-1/2 rounded-md bg-panel px-2.5 py-1.5',
              'whitespace-nowrap',
            )}
            style={{
              left: Math.min(Math.max(x(hover), 52), width - 52),
              top: Math.max(0, y(active.value) - 44),
              boxShadow: 'var(--shadow-tooltip)',
            }}
          >
            <span className="t-caption block text-text-2">
              {active.isToday ? 'Today' : active.day}
            </span>
            <span className="t-label text-text-1">
              {active.value}{' '}
              <span className="font-normal text-text-2">
                {active.value === 1 ? unit.replace(/s$/, '') : unit}
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** A rounded top for the scale, with an even midpoint: 18 → 20, 37 → 40. */
function niceTop(max: number): number {
  if (max <= 0) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 4, 5, 6, 8, 10]) {
    const candidate = m * exp;
    if (candidate >= max && Number.isInteger(candidate / 2)) return candidate;
  }
  return 10 * exp;
}

function formatTick(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v * 10) / 10);
}
