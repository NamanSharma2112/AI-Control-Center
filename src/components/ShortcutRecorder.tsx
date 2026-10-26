import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const IS_MAC =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** Renders a Tauri accelerator as the glyphs the current OS actually uses. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
          return IS_MAC ? '⌘' : 'Ctrl';
        case 'Command':
          return '⌘';
        case 'Control':
          return 'Ctrl';
        case 'Shift':
          return IS_MAC ? '⇧' : 'Shift';
        case 'Alt':
          return IS_MAC ? '⌥' : 'Alt';
        case 'Space':
          return 'Space';
        default:
          return part;
      }
    })
    .join(IS_MAC ? '' : ' + ');
}

/**
 * Records a global shortcut by listening for one real key combination.
 *
 * Only accepts a combination with at least one modifier plus a key, because a
 * bare letter registered globally would swallow typing everywhere.
 */
export function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }

      const parts: string[] = [];
      if (event.metaKey) parts.push('CommandOrControl');
      else if (event.ctrlKey) parts.push('CommandOrControl');
      if (event.shiftKey) parts.push('Shift');
      if (event.altKey) parts.push('Alt');

      const key = normalizeKey(event);
      if (!key || parts.length === 0) return;

      parts.push(key);
      onChange(parts.join('+'));
      setRecording(false);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [recording, onChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setRecording((r) => !r)}
      onBlur={() => setRecording(false)}
      aria-label="Change the toggle shortcut"
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5',
        'transition-colors duration-[90ms] inset-ring',
        recording
          ? 'bg-accent-well text-accent-text inset-ring-accent'
          : 'bg-surface-inset text-text-1 inset-ring-rule hover:bg-surface-2',
      )}
    >
      <span className="t-mono">
        {recording ? 'Press a combination…' : formatAccelerator(value)}
      </span>
      <span className="t-meta text-text-3">{recording ? 'Esc to cancel' : 'Change'}</span>
    </button>
  );
}

function normalizeKey(event: KeyboardEvent): string | null {
  const { key, code } = event;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return null;
  if (key === ' ') return 'Space';
  if (/^F\d{1,2}$/.test(key)) return key;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    return key.replace('Arrow', '');
  }
  if (key.length === 1) return key.toUpperCase();
  return null;
}
