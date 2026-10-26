import type { ProviderAdapter } from '@/providers/ProviderAdapter';
import type {
  Activity,
  Limit,
  ProviderId,
  ProviderStatus,
  Session,
  Usage,
} from '@/types/domain';
import {
  buildActivities,
  buildLimits,
  buildSessions,
  buildUsage,
  claudeCodeProfile,
  codexProfile,
  type MockProfile,
} from './fixtures';

/**
 * One mock adapter implementation, parameterised by profile. It satisfies the
 * same contract as a real adapter, so the UI cannot tell them apart — which
 * is the whole point: swapping in `localCodexAdapter` changes no component.
 */
function createMockAdapter(name: string, profile: MockProfile): ProviderAdapter {
  const id: ProviderId = profile.providerId;

  return {
    id,
    name,

    async getStatus(): Promise<ProviderStatus> {
      const running = profile.sessions.some((s) => s.status === 'running');
      return running ? 'active' : 'idle';
    },

    async getUsage(): Promise<Usage | null> {
      return buildUsage(profile);
    },

    async getLimits(): Promise<Limit[]> {
      return buildLimits(profile);
    },

    async getSessions(): Promise<Session[]> {
      return buildSessions(profile).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    },

    async getRecentActivity(limit = 40): Promise<Activity[]> {
      return buildActivities(profile)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    },

    async stopSession(sessionId: string): Promise<void> {
      // The mock has nothing to stop; it reports success so the UI's
      // confirm-then-act path can be exercised without a real process.
      void sessionId;
    },
  };
}

export const mockCodexProvider = createMockAdapter('Codex', codexProfile);
export const mockClaudeProvider = createMockAdapter('Claude Code', claudeCodeProfile);
