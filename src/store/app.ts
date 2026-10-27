import { create } from 'zustand';
import type {
  Activity,
  AppNotification,
  DaySummary,
  Project,
  ProviderId,
  ProviderSnapshot,
  Session,
  UsageHistoryPoint,
} from '@/types/domain';
import { readSnapshot } from '@/providers/ProviderAdapter';
import { PROVIDER_IDS, getAdapter, type AdapterMode } from '@/providers/registry';
import {
  deriveDaySummary,
  deriveProjects,
  deriveSystemLine,
  deriveUsageHistory,
  mergeActivities,
  mergeSessions,
} from '@/lib/derive';
import { useSettings } from './settings';
import { invokeSafe, isTauri } from '@/lib/tauri';
import type { SummonSource } from '@/lib/motion';

export type ViewRoute = 'dashboard' | 'settings' | 'welcome';

interface AppState {
  mode: AdapterMode;
  route: ViewRoute;
  /** How the panel was last summoned; decides how it arrives. */
  summon: SummonSource;
  snapshots: ProviderSnapshot[];
  sessions: Session[];
  activities: Activity[];
  history: UsageHistoryPoint[];
  projects: Project[];
  today: DaySummary;
  system: { tone: 'ok' | 'warn' | 'error' | 'idle'; label: string };
  notifications: AppNotification[];
  refreshing: boolean;
  lastRefreshedAt: number | null;
  /** True once a real read has happened, so the UI can hold its skeleton. */
  hydrated: boolean;

  setMode: (mode: AdapterMode) => void;
  setRoute: (route: ViewRoute) => void;
  setSummon: (summon: SummonSource) => void;
  refresh: () => Promise<void>;
  dismissNotification: (id: string) => void;
  /** Adds a notice from outside provider state (e.g. an available update). */
  announce: (notice: AppNotification) => void;
  clearNotifications: () => void;
  stopSession: (providerId: ProviderId, sessionId: string) => Promise<void>;
}

const EMPTY_TODAY: DaySummary = { totalActivities: 0, byProvider: [], source: 'local' };

/**
 * The store holds one composed view model, recomputed only when a snapshot
 * read completes. Components select the slice they render, so a timer tick in
 * one row never re-renders the panel.
 */
export const useApp = create<AppState>((set, get) => ({
  // Live in the desktop app, where there is local state to read. In a browser
  // preview there is none, so sample data is the honest thing to show.
  mode: isTauri() ? 'live' : 'mock',
  route: 'dashboard',
  summon: 'edge',
  snapshots: [],
  sessions: [],
  activities: [],
  history: [],
  projects: [],
  today: EMPTY_TODAY,
  system: { tone: 'idle', label: 'Reading provider state' },
  notifications: [],
  refreshing: false,
  lastRefreshedAt: null,
  hydrated: false,

  setMode(mode) {
    set({ mode });
    void get().refresh();
  },

  setRoute(route) {
    set({ route });
  },

  setSummon(summon) {
    set({ summon });
  },

  async refresh() {
    if (get().refreshing) return;
    set({ refreshing: true });

    const { mode } = get();
    const { connected } = useSettings.getState().settings;

    const snapshots = await Promise.all(
      PROVIDER_IDS.map((id) =>
        readSnapshot(getAdapter(id, mode), connected[id] ?? false),
      ),
    );

    const sessions = mergeSessions(snapshots);
    const activities = mergeActivities(snapshots);
    const before = new Set(get().notifications.map((n) => n.id));
    const notifications = reconcileNotifications(get().notifications, snapshots);

    set({
      snapshots,
      sessions,
      activities,
      history: deriveUsageHistory(activities),
      projects: deriveProjects(activities, sessions),
      today: deriveDaySummary(activities),
      system: deriveSystemLine(snapshots),
      refreshing: false,
      lastRefreshedAt: Date.now(),
      hydrated: true,
      notifications,
    });

    // Anything new also goes to the OS, which shows it only while the panel
    // is hidden: with the panel open, the in-panel notice is enough.
    for (const n of notifications) {
      if (!before.has(n.id)) void emitSystemNotification(n);
    }
  },

  announce(notice) {
    if (get().notifications.some((n) => n.id === notice.id)) return;
    set({ notifications: [notice, ...get().notifications].slice(0, 4) });
    void emitSystemNotification(notice);
  },

  dismissNotification(id) {
    set({ notifications: get().notifications.filter((n) => n.id !== id) });
  },

  clearNotifications() {
    set({ notifications: [] });
  },

  async stopSession(providerId, sessionId) {
    const adapter = getAdapter(providerId, get().mode);
    await adapter.stopSession?.(sessionId);
    await get().refresh();
  },
}));

/**
 * Notifications are generated from state, then de-duplicated against what is
 * already on screen — so a provider sitting at 88% produces one notice, not
 * one per refresh. This is the whole of "do not spam the user".
 */
/** Each session's status at the last reading; null before the first. */
let previousStatus: Map<string, string> | null = null;

function reconcileNotifications(
  existing: AppNotification[],
  snapshots: ProviderSnapshot[],
): AppNotification[] {
  const settings = useSettings.getState().settings;
  const seen = new Set(existing.map((n) => n.id));
  const next = [...existing];

  for (const snap of snapshots) {
    if (!snap.provider.connected) continue;

    if (settings.notifyOnUsage && snap.usage) {
      const remaining = 100 - snap.usage.percentage;
      if (remaining <= settings.notifyUsageThreshold) {
        const id = `usage:${snap.provider.id}:${settings.notifyUsageThreshold}`;
        if (!seen.has(id)) {
          next.push({
            id,
            kind: 'usage',
            severity: remaining <= 10 ? 'error' : 'warn',
            title: `${snap.provider.name} usage below ${remaining}%`,
            providerId: snap.provider.id,
            timestamp: Date.now(),
            read: false,
          });
        }
      }
    }

    if (settings.notifyOnError && snap.provider.status === 'error') {
      const id = `error:${snap.provider.id}`;
      if (!seen.has(id)) {
        next.push({
          id,
          kind: 'error',
          severity: 'error',
          title: `${snap.provider.name} connection unavailable`,
          ...(snap.provider.statusDetail ? { detail: snap.provider.statusDetail } : {}),
          providerId: snap.provider.id,
          timestamp: Date.now(),
          read: false,
        });
      }
    }

  }

  // Transitions since the last reading. The first reading only records the
  // baseline: an agent that finished before the app started is not news.
  const prev = previousStatus;
  previousStatus = new Map();
  for (const snap of snapshots) {
    for (const session of snap.sessions) {
      previousStatus.set(session.id, `${session.status}:${session.waitingReason ?? ''}`);
    }
  }
  if (prev === null) {
    return next.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
  }

  for (const snap of snapshots) {
    if (!snap.provider.connected) continue;
    for (const session of snap.sessions) {
      const before = prev.get(session.id);
      const now = `${session.status}:${session.waitingReason ?? ''}`;
      if (before === undefined || before === now) continue;

      if (session.status === 'completed' && settings.notifyOnSessionComplete) {
        const id = `done:${session.id}:${session.lastActivityAt}`;
        if (seen.has(id)) continue;
        const minutes = Math.max(1, Math.round((session.lastActivityAt - session.startedAt) / 60_000));
        next.push({
          id,
          kind: 'session',
          severity: 'info',
          title: `${snap.provider.name} finished in ${session.project}`,
          detail: `${minutes} min${session.filesChanged ? ` · ${session.filesChanged} files changed` : ''}`,
          providerId: snap.provider.id,
          timestamp: Date.now(),
          read: false,
        });
      }

      if (
        session.status === 'waiting' &&
        session.waitingReason === 'tool' &&
        settings.notifyOnNeedsYou
      ) {
        const id = `needs:${session.id}:${session.lastActivityAt}`;
        if (seen.has(id)) continue;
        next.push({
          id,
          kind: 'idle',
          severity: 'warn',
          title: `${snap.provider.name} is waiting in ${session.project}`,
          detail: session.currentActivity,
          providerId: snap.provider.id,
          timestamp: Date.now(),
          read: false,
        });
      }
    }
  }

  // Newest first, and never more than four on screen at once.
  return next.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
}

/** Fire an OS-level notification for anything new, when the app allows it. */
export async function emitSystemNotification(n: AppNotification): Promise<void> {
  if (!isTauri()) return;
  await invokeSafe<void>(
    'notify',
    { title: n.title, body: n.detail ?? '' },
    undefined,
  );
}
