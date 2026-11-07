import type { Activity, ProviderSnapshot, Session, StepKind } from '@/types/domain';
import { PROVIDER_NAMES } from '@/providers/registry';
import { plural } from '@/lib/format';

/**
 * The ghost's expression: what the agents are up to, at a glance, before
 * reading a word. Thinking is a model working something out; working is a
 * tool running (reading, editing, testing).
 */
export type Mood =
  | 'sleeping'
  | 'thinking'
  | 'working'
  | 'needs-you'
  | 'stuck'
  | 'done'
  | 'low';

export interface IslandSummary {
  mood: Mood;
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

/** Steps that are a tool at work, as opposed to the model thinking or replying. */
const TOOL_STEPS = new Set<StepKind>(['read', 'search', 'edit', 'test', 'command', 'git']);

/**
 * Whether a running agent is using a tool right now or thinking: a tool step
 * still in progress is work; anything else (a prompt just sent, a reply being
 * written, the gap between two tools) is the model thinking.
 */
export function isToolRunning(session: Session): boolean {
  const last = session.steps[session.steps.length - 1];
  return !!last && last.durationMs === null && TOOL_STEPS.has(last.kind);
}

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
      mood: 'needs-you',
      tone: 'attention',
      title: needsYou.length > 1 ? `${needsYou.length} agents need you` : `${PROVIDER_NAMES[s.providerId]} needs you`,
      detail: needsYou.length > 1 ? undefined : s.project,
      active: true,
    };
  }

  if (stuck?.stuck) {
    return {
      mood: 'stuck',
      tone: 'attention',
      title: `${PROVIDER_NAMES[stuck.providerId]} looks stuck`,
      detail: stuck.project,
      active: true,
    };
  }

  const mood: Mood = running.some(isToolRunning) ? 'working' : 'thinking';
  if (running.length === 1) {
    const s = running[0];
    return {
      mood,
      tone: 'working',
      title: s.currentActivity || (mood === 'thinking' ? 'Thinking' : 'Working'),
      detail: s.project,
      timerFrom: s.startedAt,
      active: true,
    };
  }
  if (running.length > 1) {
    return {
      mood,
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
      mood: 'done',
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
    return { mood: 'low', tone: 'attention', title: `${low.name}: ${low.left}% left`, active: false };
  }

  return { mood: 'sleeping', tone: 'quiet', title: 'All quiet', detail: 'No agents running', active: false };
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

/**
 * How busy the agents have been lately, for the line in the pill: how many
 * things they did in each of `buckets` slices of the last `spanMs`, oldest
 * first. Steps of live sessions count too, so the line moves while an agent
 * works, before anything lands in the activity log.
 */
export function activitySeries(
  activities: Activity[],
  sessions: Session[],
  now: number,
  buckets = 16,
  spanMs = 32 * 60_000,
): number[] {
  const series = new Array<number>(buckets).fill(0);
  const start = now - spanMs;
  const slice = spanMs / buckets;
  const add = (t: number) => {
    if (t < start || t > now) return;
    series[Math.min(buckets - 1, Math.floor((t - start) / slice))] += 1;
  };
  const seen = new Set<string>();
  for (const s of sessions) {
    for (const step of s.steps) {
      seen.add(`${s.id}:${step.startedAt}`);
      add(step.startedAt);
    }
  }
  for (const a of activities) {
    if (a.sessionId && seen.has(`${a.sessionId}:${a.timestamp}`)) continue;
    add(a.timestamp);
  }
  return series;
}
