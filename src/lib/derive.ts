import type {
  Activity,
  DaySummary,
  Project,
  ProviderId,
  ProviderSnapshot,
  Session,
  UsageHistoryPoint,
} from '@/types/domain';
import { DAY, localDateKey, startOfLocalDay, weekdayLabel } from '@/lib/time';

/**
 * Pure derivations over provider snapshots.
 *
 * Kept out of the store and out of components so they are cheap to reason
 * about and cheap to memoize: the store runs these once per snapshot change,
 * never per render.
 */

export function mergeActivities(snapshots: ProviderSnapshot[], limit = 400): Activity[] {
  return snapshots
    .flatMap((s) => s.activities)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function mergeSessions(snapshots: ProviderSnapshot[]): Session[] {
  return snapshots
    .flatMap((s) => s.sessions)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function activeSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.status === 'running' || s.status === 'waiting');
}

/** The TODAY rollup: how much happened today, and whose it was. */
export function deriveDaySummary(activities: Activity[]): DaySummary {
  const today = localDateKey(Date.now());
  const todays = activities.filter((a) => localDateKey(a.timestamp) === today);
  const counts = new Map<ProviderId, number>();
  for (const a of todays) {
    counts.set(a.providerId, (counts.get(a.providerId) ?? 0) + 1);
  }
  const total = todays.length;
  const byProvider = [...counts.entries()]
    .map(([providerId, count]) => ({
      providerId,
      count,
      share: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { totalActivities: total, byProvider, source: 'local' };
}

/** Seven days ending today, oldest first, with empty days present as zeroes. */
export function deriveUsageHistory(activities: Activity[], days = 7): UsageHistoryPoint[] {
  const todayStart = startOfLocalDay(Date.now());
  const buckets: UsageHistoryPoint[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = todayStart - i * DAY;
    buckets.push({
      date: localDateKey(dayStart),
      label: weekdayLabel(dayStart),
      total: 0,
      byProvider: {},
      source: 'local',
    });
  }

  const index = new Map(buckets.map((b) => [b.date, b]));
  for (const a of activities) {
    const bucket = index.get(localDateKey(a.timestamp));
    if (!bucket) continue;
    bucket.total += 1;
    bucket.byProvider[a.providerId] = (bucket.byProvider[a.providerId] ?? 0) + 1;
  }

  return buckets;
}

/** Where the activity went. Everything past the top four collapses to "other". */
export function deriveProjects(
  activities: Activity[],
  sessions: Session[],
  topN = 4,
): Project[] {
  const counts = new Map<string, { count: number; lastActiveAt: number }>();
  for (const a of activities) {
    if (!a.project) continue;
    const prev = counts.get(a.project) ?? { count: 0, lastActiveAt: 0 };
    counts.set(a.project, {
      count: prev.count + 1,
      lastActiveAt: Math.max(prev.lastActiveAt, a.timestamp),
    });
  }

  const total = [...counts.values()].reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];

  const pathFor = new Map(sessions.map((s) => [s.project, s.projectPath]));
  const ranked = [...counts.entries()]
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.count - a.count);

  const head = ranked.slice(0, topN);
  const tail = ranked.slice(topN);

  const projects: Project[] = head.map((p) => ({
    id: p.name,
    name: p.name,
    path: pathFor.get(p.name) ?? '',
    activityCount: p.count,
    share: Math.round((p.count / total) * 100),
    lastActiveAt: p.lastActiveAt,
    source: 'local',
  }));

  if (tail.length > 0) {
    const count = tail.reduce((sum, p) => sum + p.count, 0);
    projects.push({
      id: '__other__',
      name: 'other',
      path: '',
      activityCount: count,
      share: Math.round((count / total) * 100),
      lastActiveAt: Math.max(...tail.map((p) => p.lastActiveAt)),
      source: 'local',
    });
  }

  return projects;
}

/** Today's activities, newest first — the timeline's source. */
export function todaysActivities(activities: Activity[]): Activity[] {
  const today = localDateKey(Date.now());
  return activities.filter((a) => localDateKey(a.timestamp) === today);
}

/**
 * One line for the header. "All systems operational" only when it is true:
 * anything else names what is wrong, because a green light that lies is worse
 * than no light.
 */
export function deriveSystemLine(snapshots: ProviderSnapshot[]): {
  tone: 'ok' | 'warn' | 'error' | 'idle';
  label: string;
} {
  const connected = snapshots.filter((s) => s.provider.connected);
  if (connected.length === 0) {
    return { tone: 'idle', label: 'No providers connected' };
  }

  const errored = connected.filter((s) => s.provider.status === 'error');
  if (errored.length > 0) {
    return {
      tone: 'error',
      label:
        errored.length === 1
          ? `${errored[0].provider.name} unavailable`
          : `${errored.length} providers unavailable`,
    };
  }

  const offline = connected.filter((s) => s.provider.status === 'offline');
  if (offline.length > 0) {
    return {
      tone: 'warn',
      label:
        offline.length === 1
          ? `${offline[0].provider.name} not detected`
          : `${offline.length} providers not detected`,
    };
  }

  const low = connected.filter((s) => (s.usage?.percentage ?? 0) >= 85);
  if (low.length > 0) {
    return {
      tone: 'warn',
      label: low.length === 1 ? `${low[0].provider.name} near limit` : 'Providers near limit',
    };
  }

  return { tone: 'ok', label: 'All systems operational' };
}
