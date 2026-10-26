import { invoke as tauriInvoke } from '@tauri-apps/api/core';

/**
 * Whether we are running inside the Tauri webview. False in a plain browser
 * (`vite dev` opened directly, or a hosted preview), where the Rust commands
 * do not exist. Every call site degrades instead of throwing, so the UI is
 * reviewable in a browser without pretending the OS integration is there.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** `invoke` that resolves to `fallback` outside Tauri instead of throwing. */
export async function invokeSafe<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  if (!isTauri()) return fallback;
  try {
    return await tauriInvoke<T>(command, args);
  } catch (cause) {
    void cause;
    return fallback;
  }
}

/** `invoke` that rejects on failure — for commands whose errors must surface. */
export async function invokeStrict<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error('This action needs the desktop app.');
  }
  return tauriInvoke<T>(command, args);
}
