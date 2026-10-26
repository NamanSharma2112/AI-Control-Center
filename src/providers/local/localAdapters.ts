import type { ProviderAdapter } from '@/providers/ProviderAdapter';
import type {
  Activity,
  ActivityType,
  Limit,
  LimitWindow,
  ProviderId,
  ProviderStatus,
  Session,
  SessionStatus,
  SessionStep,
  StepKind,
  Usage,
} from '@/types/domain';
import { invokeSafe, invokeStrict } from '@/lib/tauri';
import { EMPTY_STATE, type LocalProviderStateDto } from './dto';
import { MINUTE } from '@/lib/time';

/**
 * Real provider adapters.
 *
 * These read the CLIs' own local state — the session and history files the
 * user already owns on their own disk — through Rust commands. Nothing is
 * scraped, no authenticated site is visited, no browser storage is touched.
 *
 * Because the providers do not publish a usage API, every usage figure here
 * is a local count of observed events against a cap the user set. It is
 * tagged `local`, and the UI renders that tag beside the number.
 */

/** A session is "running" only if it moved recently; otherwise it is waiting. */
const RUNNING_WINDOW = 2 * MINUTE;

function createLocalAdapter(id: ProviderId, name: string): ProviderAdapter {
  /** One read per tick, shared by the five capability calls. */
  let cache: { at: number; state: LocalProviderStateDto } | null = null;
  const CACHE_TTL = 1_500;

  async function read(): Promise<LocalProviderStateDto> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL) return cache.state;
    const state = await invokeSafe<LocalProviderStateDto>(
      'read_provider_state',
      { provider: id },
      EMPTY_STATE,
    );
    cache = { at: now, state };
    return state;
  }

  return {
    id,
    name,

    async getStatus(): Promise<ProviderStatus> {
      const state = await read();
      if (!state.available) return 'offline';
      const now = Date.now();
      const hasRunning = state.sessions.some(
        (s) => now - s.lastActivityAt < RUNNING_WINDOW,
      );
      return hasRunning ? 'active' : 'idle';
    },

    async getUsage(): Promise<Usage | null> {
      const state = await read();
      if (!state.available || !state.usage) return null;
      const { used, cap, resetAt, unit } = state.usage;
      const percentage = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
      return {
        providerId: id,
        used,
        remaining: Math.max(0, cap - used),
        percentage,
        resetAt,
        // A count we made from local files is never a provider's own figure.
        source: 'local',
        unit,
      };
    },

    async getLimits(): Promise<Limit[]> {
      const state = await read();
      if (!state.available || !state.usage) return [];
      const { cap, resetAt, window } = state.usage;
      return [
        {
          providerId: id,
          window: asLimitWindow(window),
          cap,
          resetAt,
          resetLabel: window === 'weekly' ? 'Weekly' : 'Rolling window',
          source: 'local',
        },
      ];
    },

    async getSessions(): Promise<Session[]> {
      const state = await read();
      if (!state.available) return [];
      const now = Date.now();
      return state.sessions
        .map<Session>((s) => ({
          id: s.id,
          providerId: id,
          project: s.project,
          projectPath: s.projectPath,
          status: resolveStatus(s.status, s.lastActivityAt, now),
          startedAt: s.startedAt,
          lastActivityAt: s.lastActivityAt,
          currentActivity: s.currentActivity,
          source: 'local',
          ...(s.model ? { model: s.model } : {}),
          steps: s.steps.map<SessionStep>((step) => ({
            id: step.id,
            kind: asStepKind(step.kind),
            label: step.label,
            startedAt: step.startedAt,
            durationMs: step.durationMs,
          })),
          filesChanged: s.filesChanged,
        }))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    },

    async getRecentActivity(limit = 40): Promise<Activity[]> {
      const state = await read();
      if (!state.available) return [];
      return state.activities
        .map<Activity>((a) => ({
          id: a.id,
          providerId: id,
          sessionId: a.sessionId,
          project: a.project,
          type: asActivityType(a.type),
          message: a.message,
          timestamp: a.timestamp,
          source: 'local',
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    },

    async stopSession(sessionId: string): Promise<void> {
      await invokeStrict<void>('stop_local_session', { provider: id, sessionId });
      cache = null;
    },

    invalidate() {
      cache = null;
    },
  };
}

function resolveStatus(raw: string, lastActivityAt: number, now: number): SessionStatus {
  if (raw === 'completed') return 'completed';
  if (raw === 'failed') return 'failed';
  return now - lastActivityAt < RUNNING_WINDOW ? 'running' : 'waiting';
}

const ACTIVITY_TYPES: readonly ActivityType[] = [
  'session-started',
  'session-completed',
  'session-failed',
  'task-completed',
  'file-edited',
  'command-run',
  'usage-threshold',
  'connection-lost',
];

function asActivityType(raw: string): ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(raw)
    ? (raw as ActivityType)
    : 'command-run';
}

const STEP_KINDS: readonly StepKind[] = [
  'prompt',
  'read',
  'search',
  'edit',
  'test',
  'command',
  'git',
  'reply',
  'waiting',
];

function asStepKind(raw: string): StepKind {
  return (STEP_KINDS as readonly string[]).includes(raw) ? (raw as StepKind) : 'command';
}

function asLimitWindow(raw: string): LimitWindow {
  const windows: readonly LimitWindow[] = ['session', 'daily', 'weekly', 'monthly'];
  return (windows as readonly string[]).includes(raw) ? (raw as LimitWindow) : 'session';
}

export const localCodexProvider = createLocalAdapter('codex', 'Codex');
export const localClaudeProvider = createLocalAdapter('claude-code', 'Claude Code');
