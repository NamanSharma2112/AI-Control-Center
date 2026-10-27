/**
 * Normalized domain model.
 *
 * This is the contract between provider adapters and the UI. The UI reads
 * only these shapes, so swapping a mock adapter for a real one never changes
 * a component. Adding a provider means adding an adapter, not a UI branch.
 */

/** Stable id of a provider the app knows how to talk to. */
export type ProviderId = 'codex' | 'claude-code';

/**
 * Where a value came from. This is load-bearing, not metadata: a number the
 * app derived locally is never allowed to look like a number the provider
 * reported. See PRODUCT.md, "Provenance is a feature".
 */
export type DataSource = 'provider' | 'local' | 'estimated';

export type ProviderStatus = 'active' | 'idle' | 'offline' | 'error';

export type SessionStatus = 'running' | 'waiting' | 'completed' | 'failed';

export type ActivityType =
  | 'session-started'
  | 'session-completed'
  | 'session-failed'
  | 'task-completed'
  | 'file-edited'
  | 'command-run'
  | 'usage-threshold'
  | 'connection-lost';

export type NotificationKind = 'usage' | 'session' | 'error' | 'idle';

export type NotificationSeverity = 'info' | 'warn' | 'error';

/** Which limit window a usage figure belongs to. */
export type LimitWindow = 'session' | 'daily' | 'weekly' | 'monthly';

export interface Provider {
  id: ProviderId;
  /** Display name, as the provider spells it. */
  name: string;
  /** Adapter family, so several accounts of one kind stay distinguishable. */
  type: ProviderId;
  status: ProviderStatus;
  /** Epoch ms of the last successful read. */
  lastUpdated: number;
  /** Whether the user has connected this provider in Settings. */
  connected: boolean;
  /** Present when status is 'error' — names the problem, not a code. */
  statusDetail?: string;
}

export interface Usage {
  providerId: ProviderId;
  /** Units consumed in the current window. Unit is provider-defined. */
  used: number;
  /** Units left in the current window. */
  remaining: number;
  /** 0–100, percentage of the window consumed. */
  percentage: number;
  /** Epoch ms when the current window resets, or null when unknown. */
  resetAt: number | null;
  source: DataSource;
  /** Human label for the unit, e.g. "requests" or "tokens". */
  unit: string;
}

export interface Limit {
  providerId: ProviderId;
  window: LimitWindow;
  /** Ceiling for the window, or null when the provider does not publish one. */
  cap: number | null;
  /** Epoch ms of the next reset for this window. */
  resetAt: number | null;
  /** Human description of the reset cadence, e.g. "Sunday 4:30 PM". */
  resetLabel: string;
  source: DataSource;
}

/** What kind of thing an agent step was. Decides its icon, nothing else. */
export type StepKind =
  | 'prompt'
  | 'read'
  | 'search'
  | 'edit'
  | 'test'
  | 'command'
  | 'git'
  | 'reply'
  | 'waiting';

/** One thing an agent did, in order, as the agent status card lists it. */
export interface SessionStep {
  id: string;
  kind: StepKind;
  /** Past tense once finished ("Read 12 files"), present while running. */
  label: string;
  startedAt: number;
  /** ms the step took, or null while it is still in progress. */
  durationMs: number | null;
}

export interface Session {
  id: string;
  providerId: ProviderId;
  /** Repository / directory name the agent is working in. */
  project: string;
  /** Absolute path, used by the "Open project" control. */
  projectPath: string;
  status: SessionStatus;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms of the most recent observed activity. */
  lastActivityAt: number;
  /** One short line: what the agent is doing right now. */
  currentActivity: string;
  source: DataSource;
  /** Set when the app can actually stop this local task. */
  stoppable?: boolean;
  /** Model the session ran on, as the CLI recorded it, when it recorded one. */
  model?: string;
  /** Recent steps, oldest first. Bounded; this is a glance, not a transcript. */
  steps: SessionStep[];
  /** Files the session wrote, when that can be counted from its steps. */
  filesChanged?: number;
  /** Why a waiting session is waiting: on a tool call (usually your approval) or just idle. */
  waitingReason?: 'tool' | 'idle';
}

export interface Activity {
  id: string;
  providerId: ProviderId;
  sessionId: string | null;
  project: string | null;
  type: ActivityType;
  /** One short line, in the product's own voice. */
  message: string;
  /** Epoch ms. */
  timestamp: number;
  source: DataSource;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Count of activities attributed to this project in the active range. */
  activityCount: number;
  /** 0–100 share of activity in the active range. */
  share: number;
  lastActiveAt: number;
  source: DataSource;
}

export interface UsageHistoryPoint {
  /** ISO date, YYYY-MM-DD, in the user's local timezone. */
  date: string;
  /** Short weekday label, e.g. "Mon". */
  label: string;
  /** Activity count for the day, summed across providers. */
  total: number;
  /** Per-provider breakdown for the day. */
  byProvider: Partial<Record<ProviderId, number>>;
  source: DataSource;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  /** Optional second line. Omitted when the title says everything. */
  detail?: string;
  providerId: ProviderId | null;
  timestamp: number;
  read: boolean;
}

/** The day's rollup shown in the TODAY section. */
export interface DaySummary {
  totalActivities: number;
  byProvider: Array<{ providerId: ProviderId; count: number; share: number }>;
  source: DataSource;
}

/**
 * Everything one provider adapter reports, already normalized. The store
 * composes these into the panel's view model.
 */
export interface ProviderSnapshot {
  provider: Provider;
  usage: Usage | null;
  limits: Limit[];
  sessions: Session[];
  activities: Activity[];
}
