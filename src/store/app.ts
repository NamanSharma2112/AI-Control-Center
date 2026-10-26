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

export type ViewRoute = 'dashboard' | 'settings';

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
      notifications: reconcileNotifications(get().notifications, snapshots),
    });
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

    if (settings.notifyOnIdle) {
      const idleMs = settings.idleAfterMinutes * 60_000;
      for (const session of snap.sessions) {
        if (session.status !== 'waiting') continue;
        if (Date.now() - session.lastActivityAt < idleMs) continue;
        const id = `idle:${session.id}`;
        if (seen.has(id)) continue;
        next.push({
          id,
          kind: 'idle',
          severity: 'info',
          title: `${snap.provider.name} idle for ${settings.idleAfterMinutes} minutes`,
          detail: session.project,
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
