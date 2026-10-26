import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A labelled settings row: label and optional hint left, control right. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  stacked = false,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'px-3.5 py-2',
        stacked ? 'space-y-1.5' : 'flex items-center justify-between gap-3',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="t-body block text-text-1">
          {label}
        </label>
        {hint && <p className="t-meta mt-0.5 text-text-3">{hint}</p>}
      </div>
      <div className={cn(stacked ? 'w-full' : 'shrink-0')}>{children}</div>
    </div>
  );
}

export function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[16px] w-[28px] rounded-full transition-colors duration-[180ms]',
        'inset-ring',
        checked ? 'bg-accent inset-ring-accent' : 'bg-surface-3 inset-ring-rule-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] size-3 rounded-full bg-white transition-[left] duration-[180ms] ease-out-quint',
          checked ? 'left-[14px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md bg-surface-inset p-[2px] inset-ring inset-ring-rule"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              't-label rounded-[3px] px-2 py-[3px] transition-colors duration-[90ms]',
              selected
                ? 'bg-surface-3 text-text-1 shadow-raised'
                : 'text-text-3 hover:text-text-2',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  label,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-[104px] cursor-pointer appearance-none rounded-full bg-surface-inset accent-accent inset-ring inset-ring-rule"
      />
      <span className="t-mono w-[42px] shrink-0 text-right text-text-2">
        {value}
        {unit}
      </span>
    </div>
  );
}
