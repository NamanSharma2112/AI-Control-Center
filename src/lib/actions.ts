import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Session } from '@/types/domain';
import { invokeSafe, isTauri } from '@/lib/tauri';
import { PROVIDER_NAMES } from '@/providers/registry';
import { formatElapsed } from '@/lib/time';

/**
 * The panel's controls. Deliberately few: this is an observability surface,
 * not an IDE. Each one does exactly what its label says and nothing else.
 */

export async function openProject(path: string): Promise<void> {
  if (!path) return;
  await invokeSafe<void>('open_path', { path }, undefined);
}

export async function openTerminal(path: string): Promise<void> {
  if (!path) return;
  await invokeSafe<void>('open_terminal', { path }, undefined);
}

export async function copySessionInfo(session: Session): Promise<void> {
  const lines = [
    `${PROVIDER_NAMES[session.providerId]} — ${session.project}`,
    `Status: ${session.status}`,
    `Activity: ${session.currentActivity}`,
    `Elapsed: ${formatElapsed(session.startedAt)}`,
    session.projectPath ? `Path: ${session.projectPath}` : null,
    `Session: ${session.id}`,
  ].filter((l): l is string => l !== null);

  const text = lines.join('\n');

  if (isTauri()) {
    try {
      await writeText(text);
      return;
    } catch {
      // Fall through to the web clipboard below.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked; nothing further to try, and nothing worth alarming
    // the user about for a copy.
  }
}
