import { useEffect, useRef, useState } from 'react';

/**
 * Tweens a number toward its target on an exponential ease-out, so a usage
 * figure settles instead of jumping. Snaps instantly when motion is off.
 *
 * Runs on rAF and stops the moment it arrives, so an idle panel schedules no
 * frames at all.
 */
export function useAnimatedNumber(
  target: number,
  enabled = true,
  durationMs = 420,
): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const from = useRef(enabled ? 0 : target);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      from.current = target;
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = target - origin;

    if (Math.abs(delta) < 0.01) {
      setValue(target);
      return;
    }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Exponential ease-out: fast departure, long settle.
      const eased = 1 - Math.pow(2, -10 * t);
      const next = origin + delta * (t === 1 ? 1 : eased);
      setValue(next);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        from.current = target;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, enabled, durationMs]);

  return value;
}
