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
        'px-4 py-2.5',
        stacked ? 'space-y-2' : 'flex items-center justify-between gap-4',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="t-body block text-text-1">
          {label}
        </label>
        {hint && <p className="t-caption mt-0.5 text-text-2">{hint}</p>}
      </div>
      <div className={cn(stacked ? 'w-full' : 'shrink-0')}>{children}</div>
    </div>
  );
}

/** On is the brightest thing on the row, like the primary action. */
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
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-out',
        checked ? 'bg-primary' : 'bg-rule-strong',
      )}
    >
      <span
        className={cn(
          // Anchored at left-0: an unanchored absolute child of a <button>
          // sits at its centered static position, and the translate then
          // pushes the knob out of the track.
          'absolute top-0.5 left-0 size-4 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.3)]',
          'transition-[translate,background-color] duration-200 ease-out-quint',
          checked ? 'translate-x-[18px] bg-primary-fg' : 'translate-x-0.5 bg-text-1',
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-inset p-0.5">
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
              't-label h-7 rounded-full px-3 transition-colors duration-100',
              selected
                ? 'bg-card-hover text-text-1 shadow-[0_1px_2px_rgb(0_0_0/0.25)]'
                : 'text-text-2 hover:text-text-1',
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
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-[120px] cursor-pointer appearance-none rounded-full bg-rule-strong accent-text-1"
      />
      <span className="t-mono w-[48px] shrink-0 text-right text-text-1">
        {value}
        {unit}
      </span>
    </div>
  );
}
