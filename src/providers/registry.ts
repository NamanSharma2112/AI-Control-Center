import type { ProviderAdapter } from './ProviderAdapter';
import type { CliProviderId, ProviderId } from '@/types/domain';
import {
  mockChatGptProvider,
  mockClaudeProvider,
  mockClaudeWebProvider,
  mockCodexProvider,
  mockGeminiProvider,
} from './mock/mockAdapter';
import {
  localChatGptProvider,
  localClaudeProvider,
  localClaudeWebProvider,
  localCodexProvider,
  localGeminiProvider,
} from './local/localAdapters';

/**
 * The registry is the only place that decides which implementation backs a
 * provider. Nothing else in the app imports an adapter directly, so adding a
 * provider is one entry here plus one adapter file.
 */

export type AdapterMode = 'live' | 'mock';

const LIVE: Record<ProviderId, ProviderAdapter> = {
  codex: localCodexProvider,
  'claude-code': localClaudeProvider,
  chatgpt: localChatGptProvider,
  'claude-web': localClaudeWebProvider,
  gemini: localGeminiProvider,
};

const MOCK: Record<ProviderId, ProviderAdapter> = {
  codex: mockCodexProvider,
  'claude-code': mockClaudeProvider,
  chatgpt: mockChatGptProvider,
  'claude-web': mockClaudeWebProvider,
  gemini: mockGeminiProvider,
};

export const PROVIDER_IDS: ProviderId[] = ['codex', 'claude-code', 'chatgpt', 'claude-web', 'gemini'];

/** Coding agents, read from this computer's CLI folders. */
export const CLI_PROVIDERS: CliProviderId[] = ['claude-code', 'codex'];
/** Chat sites, seen through the browser extension. */
export const BROWSER_PROVIDERS: ProviderId[] = ['chatgpt', 'claude-web', 'gemini'];

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
  chatgpt: 'ChatGPT',
  'claude-web': 'Claude',
  gemini: 'Gemini',
};
