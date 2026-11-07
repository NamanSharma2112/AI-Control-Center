import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';
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

interface FocusOutcome {
  result: 'focused' | 'notFound';
  app?: string;
}

/**
 * Brings the agent's own terminal to the front. When its window cannot be
 * found (an agent over SSH, a terminal we cannot see into), opens a new
 * terminal in the project instead, which is the next most useful thing.
 */
export async function jumpToAgent(session: Session): Promise<void> {
  if (!isTauri()) {
    toast('Jumping to the terminal needs the desktop app');
    return;
  }
  const outcome = await invokeSafe<FocusOutcome>(
    'focus_agent',
    { provider: session.providerId, projectPath: session.projectPath },
    { result: 'notFound' },
  );
  if (outcome.result === 'focused') return;
  await openTerminal(session.projectPath);
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
