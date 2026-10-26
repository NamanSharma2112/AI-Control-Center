import type {
  Activity,
  LimitWindow,
  ProviderId,
  ProviderSnapshot,
  Session,
  UsageHistoryPoint,
} from '@/types/domain';
import { DAY, HOUR, formatCountdown, localDateKey, startOfLocalDay, weekdayLabel } from '@/lib/time';
import { PROVIDER_NAMES } from '@/providers/registry';

/**
 * Derived insights for the console layout: the per-category series behind the
 * metric cards, the week's provider split, and the forecast sentence.
 *
 * Every function is pure and runs once per snapshot change in the store, so
 * nothing here is recomputed on a render or a timer tick.
 */

export interface SeriesPoint {
  /** One-letter weekday, as the chart axis shows it. */
  label: string;
  /** Full weekday, for the tooltip. */
  day: string;
  value: number;
  isToday: boolean;
}

export function providerSeries(
  history: UsageHistoryPoint[],
  providerId: ProviderId,
): SeriesPoint[] {
  return history.map((point, i) => ({
    label: point.label.slice(0, 1),
    day: point.label,
    value: point.byProvider[providerId] ?? 0,
    isToday: i === history.length - 1,
  }));
}

/** Sessions started per day, across every provider. */
export function sessionSeries(activities: Activity[], days = 7): SeriesPoint[] {
  const todayStart = startOfLocalDay(Date.now());
  const buckets = new Map<string, SeriesPoint>();
  const order: string[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = todayStart - i * DAY;
    const key = localDateKey(dayStart);
    const label = weekdayLabel(dayStart);
    order.push(key);
    buckets.set(key, { label: label.slice(0, 1), day: label, value: 0, isToday: i === 0 });
  }

  for (const a of activities) {
    if (a.type !== 'session-started') continue;
    const bucket = buckets.get(localDateKey(a.timestamp));
    if (bucket) bucket.value += 1;
  }

  return order.map((key) => buckets.get(key)!);
}

export function seriesTotal(series: SeriesPoint[]): number {
  return series.reduce((sum, p) => sum + p.value, 0);
}

export interface ProviderShare {
  providerId: ProviderId;
  name: string;
  count: number;
}

/** The week's activity, split by provider, largest first. */
export function weeklySplit(history: UsageHistoryPoint[]): ProviderShare[] {
  const totals = new Map<ProviderId, number>();
  for (const point of history) {
    for (const [id, count] of Object.entries(point.byProvider) as Array<[ProviderId, number]>) {
      totals.set(id, (totals.get(id) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .map(([providerId, count]) => ({ providerId, name: PROVIDER_NAMES[providerId], count }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function runningCount(sessions: Session[]): number {
  return sessions.filter((s) => s.status === 'running').length;
}

/* ------------------------------------------------------------------------
   Forecast
   ------------------------------------------------------------------------ */

const WINDOW_MS: Record<LimitWindow, number> = {
  session: 5 * HOUR,
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
};

export interface ProviderForecast {
  providerId: ProviderId;
  name: string;
  resetAt: number;
  /** When the window empties at the current pace, or null if it never does. */
  exhaustAt: number | null;
  runsOutFirst: boolean;
}

/**
 * Projects each provider's current-window burn rate forward.
 *
 * Rate is "share of the window used so far, divided by time elapsed in the
 * window". It is a straight-line estimate and is always labelled as one: the
 * point is to warn early, not to predict to the minute.
 */
export function forecastProviders(
  snapshots: ProviderSnapshot[],
  now: number = Date.now(),
): ProviderForecast[] {
  const out: ProviderForecast[] = [];

  for (const snap of snapshots) {
    if (!snap.provider.connected || !snap.usage || snap.usage.resetAt === null) continue;
    const window = snap.limits[0]?.window ?? 'session';
    const resetAt = snap.usage.resetAt;
    // Guard the start of a window, where a tiny elapsed time would make any
    // usage look like a runaway burn rate.
    const elapsed = Math.max(10 * 60_000, WINDOW_MS[window] - (resetAt - now));
    const rate = snap.usage.percentage / elapsed;
    const remaining = 100 - snap.usage.percentage;
    const exhaustAt = rate > 0 ? now + remaining / rate : null;

    out.push({
      providerId: snap.provider.id,
      name: snap.provider.name,
      resetAt,
      exhaustAt,
      runsOutFirst: exhaustAt !== null && exhaustAt < resetAt,
    });
  }

  return out;
}

/** A sentence as styled runs, so the figures can be set in a heavier weight. */
export type Run = { text: string; strong?: boolean };

export function forecastSentence(
  snapshots: ProviderSnapshot[],
  weekTotal: number,
  now: number = Date.now(),
): Run[] {
  const runs: Run[] = [];

  if (weekTotal > 0) {
    const perDay = Math.max(1, Math.round(weekTotal / 7));
    runs.push(
      { text: 'This week your agents averaged ' },
      { text: `${perDay} ${perDay === 1 ? 'action' : 'actions'} a day`, strong: true },
      { text: '. ' },
    );
  } else {
    runs.push({ text: 'No agent activity recorded this week. ' });
  }

  const forecasts = forecastProviders(snapshots, now);
  const atRisk = forecasts
    .filter((f) => f.runsOutFirst && f.exhaustAt !== null)
    .sort((a, b) => a.exhaustAt! - b.exhaustAt!);

  if (atRisk.length > 0) {
    const f = atRisk[0];
    runs.push(
      { text: 'At that pace ' },
      { text: f.name, strong: true },
      { text: ' runs out ' },
      { text: when(f.exhaustAt!, now), strong: true },
      { text: ', before it resets ' },
      { text: when(f.resetAt, now), strong: true },
      { text: '.' },
    );
  } else if (forecasts.length === 1) {
    const f = forecasts[0];
    runs.push(
      { text: `At that pace ${f.name} lasts until it resets ` },
      { text: when(f.resetAt, now), strong: true },
      { text: '.' },
    );
  } else if (forecasts.length > 1) {
    runs.push({ text: 'At that pace every provider lasts until its next reset.' });
  } else {
    runs.push({ text: 'No connected provider reports a usage limit.' });
  }

  return runs;
}

/** "in 1h 21m", "on Thursday", or "on Oct 30" — the shortest honest form. */
function when(target: number, now: number): string {
  const delta = target - now;
  if (delta < DAY) return `in ${formatCountdown(target, now)}`;
  const date = new Date(target);
  if (delta < 6 * DAY) {
    return `on ${date.toLocaleDateString(undefined, { weekday: 'long' })}`;
  }
  return `on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
