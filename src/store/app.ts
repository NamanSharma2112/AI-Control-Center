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
import { isTauri } from '@/lib/tauri';
import { deliver } from '@/lib/notify';
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
  /** Every notice delivered so far, newest first: the ledger that stops a
   *  state from being announced twice. Shown nowhere; notices are toasts while
   *  the panel is open and OS notifications while it is hidden. */
  notifications: AppNotification[];
  /** Whether the panel is on screen right now. */
  panelVisible: boolean;
  refreshing: boolean;
  lastRefreshedAt: number | null;
  /** True once a real read has happened, so the UI can hold its skeleton. */
  hydrated: boolean;

  setMode: (mode: AdapterMode) => void;
  setRoute: (route: ViewRoute) => void;
  setSummon: (summon: SummonSource) => void;
  setPanelVisible: (visible: boolean) => void;
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
  // The desktop app starts hidden in the tray; a browser preview is on screen.
  panelVisible: !isTauri(),
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

  setPanelVisible(visible) {
    set({ panelVisible: visible });
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

    for (const n of notifications) {
      if (!before.has(n.id)) deliver(n, get().panelVisible);
    }
    scheduleResetAlerts(snapshots);
  },

  announce(notice) {
    if (get().notifications.some((n) => n.id === notice.id)) return;
    set({ notifications: [notice, ...get().notifications].slice(0, LEDGER_SIZE) });
    deliver(notice, get().panelVisible);
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

/** How many delivered notices are remembered for de-duplication. */
const LEDGER_SIZE = 60;

/** Each session's status at the last reading; null before the first. */
let previousStatus: Map<string, string> | null = null;

/**
 * Notifications are generated from state, then de-duplicated against those
 * already delivered — so a provider sitting at 88% produces one notice, not
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
  for (const snap of snapshots) {
    if (!snap.provider.connected) continue;
    for (const session of snap.sessions) {
      // No previous reading means no transition (and nothing below fires).
      const before = prev?.get(session.id);
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

  // A stuck agent is news whenever it is spotted, even on the first reading,
  // as long as it is still live: one notice per session and command.
  if (settings.notifyOnStuck) {
    for (const snap of snapshots) {
      if (!snap.provider.connected) continue;
      for (const session of snap.sessions) {
        if (!session.stuck) continue;
        if (session.status !== 'running' && session.status !== 'waiting') continue;
        if (Date.now() - session.lastActivityAt > 30 * 60_000) continue;
        const id = `stuck:${session.id}:${session.stuck.command}`;
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({
          id,
          kind: 'error',
          severity: 'warn',
          title: `${snap.provider.name} looks stuck in ${session.project}`,
          detail: `"${session.stuck.command}" has failed ${session.stuck.failures} times`,
          providerId: snap.provider.id,
          timestamp: Date.now(),
          read: false,
        });
      }
    }
  }

  return next.sort((a, b) => b.timestamp - a.timestamp).slice(0, LEDGER_SIZE);
}

/**
 * "Available again": when you were low on a provider, a timer is set for its
 * reset, and the moment it passes you are told. Timers are re-armed on every
 * reading, so a reset time that moves (a fresh provider report) is followed.
 */
const resetTimers = new Map<ProviderId, { at: number; handle: number }>();

function scheduleResetAlerts(snapshots: ProviderSnapshot[]): void {
  const settings = useSettings.getState().settings;
  const now = Date.now();
  for (const snap of snapshots) {
    const id = snap.provider.id;
    const usage = snap.usage;
    const at = usage?.resetAt ?? null;
    const low = usage !== null && 100 - usage.percentage <= settings.notifyUsageThreshold;
    const existing = resetTimers.get(id);
    const clear = () => {
      if (existing) window.clearTimeout(existing.handle);
      resetTimers.delete(id);
    };

    // 1. Alerts off, or provider disconnected: no timer.
    if (!settings.notifyOnReset || !snap.provider.connected) {
      clear();
      continue;
    }
    // 2. Not low (or no known reset): keep a timer only if it is for this
    //    same window — it was armed when you were low in it.
    if (!low || at === null || at <= now) {
      if (existing && existing.at !== at) clear();
      continue;
    }
    // 3. Low, with a known reset ahead: make sure a timer is set for it.
    if (existing?.at === at) continue;
    clear();

    const name = snap.provider.name;
    const handle = window.setTimeout(() => {
      resetTimers.delete(id);
      useApp.getState().announce({
        id: `reset:${id}:${at}`,
        kind: 'usage',
        severity: 'info',
        title: `${name} is available again`,
        detail: 'Your usage limit has reset.',
        providerId: id,
        timestamp: Date.now(),
        read: false,
      });
      void useApp.getState().refresh();
      // A couple of seconds late, so the provider has reset by the time we say so.
    }, Math.min(at - Date.now() + 2_000, 2 ** 31 - 1));
    resetTimers.set(id, { at, handle });
  }
}
