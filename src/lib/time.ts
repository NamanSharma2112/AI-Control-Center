/** Time formatting. All of it, so no component invents its own format. */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** `04:13` or `1:02:44` — an elapsed timer that never changes width mid-count. */
export function formatElapsed(fromMs: number, nowMs: number = Date.now()): string {
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `1h 24m`, `18m`, `3d 4h` — time until a reset, in the largest two units. */
export function formatCountdown(targetMs: number, nowMs: number = Date.now()): string {
  const delta = targetMs - nowMs;
  if (delta <= 0) return 'now';
  const d = Math.floor(delta / DAY);
  const h = Math.floor((delta % DAY) / HOUR);
  const m = Math.floor((delta % HOUR) / MINUTE);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** `12:41` — wall-clock, locale-aware, no seconds. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `Sunday 4:30 PM` — a recurring reset the user can plan around. */
export function formatResetLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `4m ago`, `2h ago`, `Tue` — a past moment, shortest honest form. */
export function formatRelative(ms: number, nowMs: number = Date.now()): string {
  const delta = nowMs - ms;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) {
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Local-timezone `YYYY-MM-DD`, for grouping by day without UTC drift. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekdayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export { DAY, HOUR, MINUTE };

/** `1.9s`, `41s`, `2m 3s`, `1h 4m` — a step's duration, as precise as it is useful. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) {
    const m = Math.floor(ms / MINUTE);
    const s = Math.round((ms % MINUTE) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MINUTE);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
