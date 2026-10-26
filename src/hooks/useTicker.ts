import { useEffect, useState } from 'react';

/**
 * A shared 1s clock for elapsed timers.
 *
 * One interval for the whole panel, and only while something actually needs
 * it: pass `active: false` and no timer is scheduled, which is how the app
 * costs nothing while no agent is running.
 */
export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [active, intervalMs]);

  return now;
}
