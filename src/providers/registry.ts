import type { ProviderAdapter } from './ProviderAdapter';
import type { ProviderId } from '@/types/domain';
import { mockClaudeProvider, mockCodexProvider } from './mock/mockAdapter';
import { localClaudeProvider, localCodexProvider } from './local/localAdapters';

/**
 * The registry is the only place that decides which implementation backs a
 * provider. Nothing else in the app imports an adapter directly, so adding a
 * provider is one entry here plus one adapter file.
 */

export type AdapterMode = 'live' | 'mock';

const LIVE: Record<ProviderId, ProviderAdapter> = {
  codex: localCodexProvider,
  'claude-code': localClaudeProvider,
};

const MOCK: Record<ProviderId, ProviderAdapter> = {
  codex: mockCodexProvider,
  'claude-code': mockClaudeProvider,
};

export const PROVIDER_IDS: ProviderId[] = ['codex', 'claude-code'];

export function getAdapter(id: ProviderId, mode: AdapterMode): ProviderAdapter {
  return mode === 'live' ? LIVE[id] : MOCK[id];
}

export function getAdapters(mode: AdapterMode): ProviderAdapter[] {
  return PROVIDER_IDS.map((id) => getAdapter(id, mode));
}

/** Display name without needing an adapter instance. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
};
