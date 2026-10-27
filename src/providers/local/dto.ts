/**
 * Wire shapes returned by the Rust side. These mirror the serde structs in
 * `src-tauri/src/providers.rs` and exist only at the boundary; the adapters
 * map them onto the normalized domain model immediately.
 */

export interface LocalStepDto {
  id: string;
  /** Domain StepKind string. */
  kind: string;
  label: string;
  startedAt: number;
  durationMs: number | null;
}

export interface LocalSessionDto {
  id: string;
  project: string;
  projectPath: string;
  /** 'running' | 'waiting' | 'completed' */
  status: string;
  startedAt: number;
  lastActivityAt: number;
  currentActivity: string;
  eventCount: number;
  model: string | null;
  steps: LocalStepDto[];
  filesChanged: number;
  turnEnded: boolean;
  pendingTool: boolean;
}

export interface LocalActivityDto {
  id: string;
  sessionId: string | null;
  project: string | null;
  /** Domain ActivityType string. */
  type: string;
  message: string;
  timestamp: number;
}

export interface LocalUsageDto {
  /** Observed events in the current window — a local count, never a provider figure. */
  used: number;
  /** Ceiling the user configured, or a conservative default. */
  cap: number;
  resetAt: number | null;
  unit: string;
  window: string;
}

export interface LocalProviderStateDto {
  /** False when the CLI's state directory does not exist on this machine. */
  available: boolean;
  /** Set when available is false, or a read partially failed. */
  detail: string | null;
  sessions: LocalSessionDto[];
  activities: LocalActivityDto[];
  usage: LocalUsageDto | null;
}

export const EMPTY_STATE: LocalProviderStateDto = {
  available: false,
  detail: 'Desktop app required to read local provider state.',
  sessions: [],
  activities: [],
  usage: null,
};
