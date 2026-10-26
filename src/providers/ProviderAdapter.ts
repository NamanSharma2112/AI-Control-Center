import type {
  Activity,
  Limit,
  Provider,
  ProviderId,
  ProviderSnapshot,
  ProviderStatus,
  Session,
  Usage,
} from '@/types/domain';

/**
 * The capability contract every provider must satisfy.
 *
 * An adapter's job is translation: take whatever a provider exposes — a local
 * state directory, a CLI, one day an HTTP API — and return the normalized
 * shapes in `@/types/domain`. Adapters never format for display and never
 * decide what the UI shows.
 *
 * Any capability a provider genuinely cannot serve returns an empty or null
 * result rather than a fabricated one. `getUsage()` returning null means
 * "this provider does not publish usage", and the UI says exactly that.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;

  /** Cheap liveness check. Must not do heavy work. */
  getStatus(): Promise<ProviderStatus>;

  /** Current consumption for the active window, or null when unavailable. */
  getUsage(): Promise<Usage | null>;

  /** Known limit windows. Empty when the provider publishes none. */
  getLimits(): Promise<Limit[]>;

  /** Sessions the provider knows about, most recent first. */
  getSessions(): Promise<Session[]>;

  /** Recent activity, newest first, bounded by `limit`. */
  getRecentActivity(limit?: number): Promise<Activity[]>;

  /**
   * Optional: stop a local task this adapter started. Only implemented where
   * the adapter genuinely controls the process. Absence means the UI hides
   * the control rather than offering an action that cannot work.
   */
  stopSession?(sessionId: string): Promise<void>;

  /**
   * Optional: subscribe to change notifications so the app can be
   * event-driven instead of polling. Returns an unsubscribe function.
   */
  subscribe?(onChange: () => void): Promise<() => void> | (() => void);

  /** Optional: drop any cached reads, for the explicit Refresh control. */
  invalidate?(): void;
}

/**
 * Reads every capability once and assembles a snapshot. Each capability is
 * isolated: one failing read degrades that field instead of losing the
 * provider, which is what keeps a half-available provider useful.
 */
export async function readSnapshot(
  adapter: ProviderAdapter,
  connected: boolean,
  activityLimit = 200,
): Promise<ProviderSnapshot> {
  const [status, usage, limits, sessions, activities] = await Promise.all([
    settle(() => adapter.getStatus(), 'offline' as ProviderStatus),
    settle(() => adapter.getUsage(), null),
    settle(() => adapter.getLimits(), [] as Limit[]),
    settle(() => adapter.getSessions(), [] as Session[]),
    settle(() => adapter.getRecentActivity(activityLimit), [] as Activity[]),
  ]);

  const provider: Provider = {
    id: adapter.id,
    name: adapter.name,
    type: adapter.id,
    status: connected ? status.value : 'offline',
    lastUpdated: Date.now(),
    connected,
    ...(status.error ? { statusDetail: status.error } : {}),
  };

  return {
    provider,
    usage: usage.value,
    limits: limits.value,
    sessions: sessions.value,
    activities: activities.value,
  };
}

interface Settled<T> {
  value: T;
  error?: string;
}

async function settle<T>(read: () => Promise<T>, fallback: T): Promise<Settled<T>> {
  try {
    return { value: await read() };
  } catch (cause) {
    return { value: fallback, error: describe(cause) };
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'Unreadable provider state';
}
