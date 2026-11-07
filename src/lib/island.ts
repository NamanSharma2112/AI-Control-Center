import type { ProviderSnapshot, Session } from '@/types/domain';
import { PROVIDER_NAMES } from '@/providers/registry';
import { plural } from '@/lib/format';

/** The ghost's three moods, as bot-avatars names them. */
export type GhostState = 'sleeping' | 'default' | 'working';

export interface IslandSummary {
  ghost: GhostState;
  /** Colours the line: amber for "needs you", green for "done". */
  tone: 'attention' | 'done' | 'working' | 'quiet';
  title: string;
  detail?: string;
  /** Started-at for a live timer on the right, when one agent is working. */
  timerFrom?: number;
  /** Whether anything is happening that the ghost should animate for. */
  active: boolean;
}

const RECENT_DONE_MS = 10 * 60_000;

/**
 * The single most important thing, in one line. In order: an agent that
 * needs you, an agent that is stuck, agents working, one that just finished,
 * a provider running low, and finally quiet. One line is the whole point of
 * the collapsed island, so everything else waits for the hover.
 */
export function summarize(
  sessions: Session[],
  snapshots: ProviderSnapshot[],
  lowThreshold: number,
  now: number,
): IslandSummary {
  const needsYou = sessions.filter((s) => s.status === 'waiting' && s.waitingReason !== 'idle');
  const running = sessions.filter((s) => s.status === 'running');
  const stuck = sessions.find((s) => s.stuck && (s.status === 'running' || s.status === 'waiting'));

  if (needsYou.length > 0) {
    const s = needsYou[0];
    return {
      ghost: 'default',
      tone: 'attention',
      title: needsYou.length > 1 ? `${needsYou.length} agents need you` : `${PROVIDER_NAMES[s.providerId]} needs you`,
      detail: needsYou.length > 1 ? undefined : s.project,
      active: true,
    };
  }

  if (stuck?.stuck) {
    return {
      ghost: 'default',
      tone: 'attention',
      title: `${PROVIDER_NAMES[stuck.providerId]} looks stuck`,
      detail: stuck.project,
      active: true,
    };
  }

  if (running.length === 1) {
    const s = running[0];
    return {
      ghost: 'working',
      tone: 'working',
      title: s.currentActivity || 'Working',
      detail: s.project,
      timerFrom: s.startedAt,
      active: true,
    };
  }
  if (running.length > 1) {
    return {
      ghost: 'working',
      tone: 'working',
      title: `${running.length} agents working`,
      detail: [...new Set(running.map((s) => s.project))].slice(0, 2).join(', '),
      active: true,
    };
  }

  const finished = sessions
    .filter((s) => s.status === 'completed' && now - s.lastActivityAt < RECENT_DONE_MS)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
  if (finished) {
    return {
      ghost: 'default',
      tone: 'done',
      title: `${PROVIDER_NAMES[finished.providerId]} finished`,
      detail: finished.filesChanged
        ? `${finished.project} · ${plural(finished.filesChanged, 'file')} changed`
        : finished.project,
      active: false,
    };
  }

  const low = snapshots
    .filter((s) => s.provider.connected && s.usage)
    .map((s) => ({ name: s.provider.name, left: 100 - s.usage!.percentage }))
    .filter((x) => x.left <= lowThreshold)
    .sort((a, b) => a.left - b.left)[0];
  if (low) {
    return { ghost: 'default', tone: 'attention', title: `${low.name}: ${low.left}% left`, active: false };
  }

  return { ghost: 'sleeping', tone: 'quiet', title: 'All quiet', detail: 'No agents running', active: false };
}

/** The agents the open island lists: needs-you first, then working, then just finished. */
export function islandAgents(sessions: Session[], now: number, max = 4): Session[] {
  const rank = (s: Session) =>
    s.status === 'waiting' && s.waitingReason !== 'idle'
      ? 0
      : s.status === 'running'
        ? 1
        : s.status === 'waiting'
          ? 2
          : 3;
  return sessions
    .filter(
      (s) =>
        s.status === 'running' ||
        s.status === 'waiting' ||
        (s.status === 'completed' && now - s.lastActivityAt < 60 * 60_000),
    )
    .sort((a, b) => rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt)
    .slice(0, max);
}
