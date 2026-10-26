import type { ComponentType, MouseEvent } from 'react';
import { cn } from '@/lib/cn';

interface IconButtonProps {
  icon: ComponentType<{ size?: number | string; strokeWidth?: number; className?: string }>;
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Error tone for a destructive action, so it never looks routine. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  spinning?: boolean;
  className?: string;
}

/**
 * The only button shape in the panel. Hover is background and opacity at 90ms
 * with no movement — a control in an instrument does not bounce.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  disabled = false,
  spinning = false,
  className,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-sm',
        'text-text-3 transition-[color,background-color] duration-[90ms]',
        'hover:bg-surface-2 focus-visible:bg-surface-2',
        tone === 'danger' ? 'hover:text-error' : 'hover:text-text-1',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <Icon size={13} strokeWidth={1.5} className={cn(spinning && 'animate-spin')} />
    </button>
  );
}
