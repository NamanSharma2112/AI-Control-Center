import type {
  Activity,
  ActivityType,
  Limit,
  ProviderId,
  Session,
  SessionStep,
  StepKind,
  Usage,
} from '@/types/domain';
import { DAY, HOUR, MINUTE, formatResetLabel } from '@/lib/time';

/**
 * Mock fixtures.
 *
 * These exist so the UI can be built and reviewed complete before any real
 * provider is wired up, and so the panel has something honest to show on a
 * first run. Mock adapters tag their usage `estimated`, so a mock number can
 * never pass for a figure a provider actually reported.
 */

/** Anchored once at module load so timers and countdowns look live. */
const t0 = Date.now();

export interface MockProfile {
  providerId: ProviderId;
  usedPct: number;
  unit: string;
  cap: number;
  /** ms from now until the current window resets. */
  resetIn: number;
  resetWindow: Limit['window'];
  sessions: Array<{
    project: string;
    projectPath: string;
    status: Session['status'];
    startedMsAgo: number;
    lastActivityMsAgo: number;
    currentActivity: string;
    stoppable?: boolean;
    model: string;
    /** Oldest first. A null duration is the step still in progress. */
    steps: Array<{ kind: StepKind; label: string; ms: number | null }>;
  }>;
  activities: Array<{
    type: ActivityType;
    message: string;
    project: string | null;
    msAgo: number;
  }>;
}

export const codexProfile: MockProfile = {
  providerId: 'codex',
  usedPct: 22,
  unit: 'requests',
  cap: 1500,
  resetIn: 4 * DAY + 6 * HOUR + 12 * MINUTE,
  resetWindow: 'weekly',
  sessions: [
    {
      project: 'opspulse',
      projectPath: '/Users/dev/code/opspulse',
      status: 'running',
      startedMsAgo: 3 * MINUTE + 21_000,
      lastActivityMsAgo: 2_000,
      currentActivity: 'Running tests 10 of 12',
      stoppable: true,
      model: 'gpt-5-codex',
      steps: [
        { kind: 'prompt', label: 'Fix proration rounding on plan changes', ms: 600 },
        { kind: 'read', label: 'Read 12 files', ms: 1_900 },
        { kind: 'search', label: 'Found 4 call sites', ms: 1_500 },
        { kind: 'edit', label: 'Edited src/billing/invoice.ts', ms: 2_500 },
        { kind: 'edit', label: 'Updated 5 test files', ms: 1_900 },
        { kind: 'test', label: 'Running tests 10 of 12', ms: null },
      ],
    },
    {
      project: 'infra-terraform',
      projectPath: '/Users/dev/code/infra-terraform',
      status: 'waiting',
      startedMsAgo: 26 * MINUTE,
      lastActivityMsAgo: 4 * MINUTE,
      currentActivity: 'Needs your approval to run terraform apply',
      model: 'gpt-5-codex',
      steps: [
        { kind: 'read', label: 'Read 7 modules', ms: 3_100 },
        { kind: 'edit', label: 'Edited modules/vpc/main.tf', ms: 41_000 },
        { kind: 'command', label: 'Ran terraform plan', ms: 18_400 },
        { kind: 'waiting', label: 'Needs your approval to run terraform apply', ms: null },
      ],
    },
  ],
  activities: [
    { type: 'command-run', message: 'Running test suite', project: 'opspulse', msAgo: 3 * MINUTE },
    { type: 'task-completed', message: 'Tests completed', project: 'opspulse', msAgo: 22 * MINUTE },
    { type: 'file-edited', message: 'Edited 4 files in src/collectors', project: 'opspulse', msAgo: 41 * MINUTE },
    { type: 'session-started', message: 'Session started', project: 'opspulse', msAgo: 55 * MINUTE },
    { type: 'session-completed', message: 'Session finished', project: 'infra-terraform', msAgo: 2 * HOUR + 14 * MINUTE },
    { type: 'file-edited', message: 'Edited main.tf', project: 'infra-terraform', msAgo: 2 * HOUR + 40 * MINUTE },
    { type: 'session-started', message: 'Session started', project: 'infra-terraform', msAgo: 3 * HOUR + 5 * MINUTE },
    { type: 'task-completed', message: 'Migration applied', project: 'opspulse', msAgo: 5 * HOUR },
    { type: 'session-completed', message: 'Session finished', project: 'opspulse', msAgo: 26 * HOUR },
    { type: 'session-started', message: 'Session started', project: 'open-source', msAgo: 29 * HOUR },
  ],
};

export const claudeCodeProfile: MockProfile = {
  providerId: 'claude-code',
  usedPct: 70,
  unit: 'tokens',
  cap: 2_000_000,
  resetIn: 1 * HOUR + 50 * MINUTE,
  resetWindow: 'session',
  sessions: [
    {
      project: 'motionlib',
      projectPath: '/Users/dev/code/motionlib',
      status: 'running',
      startedMsAgo: 7 * MINUTE + 14_000,
      lastActivityMsAgo: 3_000,
      currentActivity: 'Editing src/animation.ts',
      stoppable: true,
      model: 'claude-sonnet-4-5-20250929',
      steps: [
        { kind: 'prompt', label: 'Add interruptible spring presets', ms: 500 },
        { kind: 'read', label: 'Read 9 files', ms: 2_200 },
        { kind: 'search', label: 'Found 3 easing call sites', ms: 1_400 },
        { kind: 'edit', label: 'Edited src/spring.ts', ms: 12_600 },
        { kind: 'test', label: 'Passed 31 of 31 tests', ms: 4_800 },
        { kind: 'edit', label: 'Editing src/animation.ts', ms: null },
      ],
    },
    {
      project: 'open-source',
      projectPath: '/Users/dev/code/open-source',
      status: 'completed',
      startedMsAgo: 1 * HOUR + 31 * MINUTE,
      lastActivityMsAgo: 1 * HOUR + 12 * MINUTE,
      currentActivity: 'Pushed docs/rewrite-guides',
      model: 'claude-sonnet-4-5-20250929',
      steps: [
        { kind: 'read', label: 'Read 14 guides', ms: 3_400 },
        { kind: 'edit', label: 'Rewrote 6 guides', ms: 9 * MINUTE },
        { kind: 'test', label: 'Passed link check', ms: 6_100 },
        { kind: 'git', label: 'Pushed docs/rewrite-guides', ms: 1_400 },
      ],
    },
  ],
  activities: [
    { type: 'file-edited', message: 'Editing animation.ts', project: 'motionlib', msAgo: 2 * MINUTE },
    { type: 'task-completed', message: 'Implemented animation controls', project: 'motionlib', msAgo: 14 * MINUTE },
    { type: 'session-started', message: 'Session started', project: 'motionlib', msAgo: 31 * MINUTE },
    { type: 'session-completed', message: 'Session finished', project: 'motionlib', msAgo: 1 * HOUR + 12 * MINUTE },
    { type: 'file-edited', message: 'Edited spring.ts and easing.ts', project: 'motionlib', msAgo: 1 * HOUR + 36 * MINUTE },
    { type: 'session-started', message: 'Session started', project: 'motionlib', msAgo: 2 * HOUR + 2 * MINUTE },
    { type: 'task-completed', message: 'Docs rewritten', project: 'open-source', msAgo: 4 * HOUR + 18 * MINUTE },
    { type: 'session-completed', message: 'Session finished', project: 'open-source', msAgo: 27 * HOUR },
  ],
};

export function buildUsage(p: MockProfile): Usage {
  const used = Math.round((p.cap * p.usedPct) / 100);
  return {
    providerId: p.providerId,
    used,
    remaining: p.cap - used,
    percentage: p.usedPct,
    resetAt: t0 + p.resetIn,
    source: 'estimated',
    unit: p.unit,
  };
}

export function buildLimits(p: MockProfile): Limit[] {
  const resetAt = t0 + p.resetIn;
  return [
    {
      providerId: p.providerId,
      window: p.resetWindow,
      cap: p.cap,
      resetAt,
      resetLabel: p.resetWindow === 'weekly' ? formatResetLabel(resetAt) : 'Rolling window',
      source: 'estimated',
    },
  ];
}

export function buildSessions(p: MockProfile): Session[] {
  return p.sessions.map((s, i) => {
    const id = `${p.providerId}-mock-session-${i}`;
    return {
      id,
      providerId: p.providerId,
      project: s.project,
      projectPath: s.projectPath,
      status: s.status,
      startedAt: t0 - s.startedMsAgo,
      lastActivityAt: t0 - s.lastActivityMsAgo,
      currentActivity: s.currentActivity,
      source: 'local' as const,
      model: s.model,
      steps: buildSteps(id, s.steps, t0 - s.lastActivityMsAgo),
      filesChanged: countEdits(s.steps),
      ...(s.status === 'waiting' ? { waitingReason: 'tool' as const } : {}),
      ...(s.stoppable ? { stoppable: true } : {}),
    };
  });
}

/**
 * Lays steps out backwards from the session's last activity, so the in-progress
 * step began exactly when the session last moved and the log reads in order.
 */
function buildSteps(
  sessionId: string,
  steps: MockProfile['sessions'][number]['steps'],
  lastActivityAt: number,
): SessionStep[] {
  const out: SessionStep[] = [];
  let cursor = lastActivityAt;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    // The open step started at the last activity; finished ones end where
    // the following step began.
    const startedAt = step.ms === null ? cursor : cursor - step.ms;
    out.unshift({
      id: `${sessionId}-step-${i}`,
      kind: step.kind,
      label: step.label,
      startedAt,
      durationMs: step.ms,
    });
    cursor = startedAt - 400;
  }
  return out;
}

function countEdits(steps: MockProfile['sessions'][number]['steps']): number {
  let files = 0;
  for (const step of steps) {
    if (step.kind !== 'edit') continue;
    const n = /(\d+)/.exec(step.label);
    files += n ? Number(n[1]) : 1;
  }
  return files;
}

export function buildActivities(p: MockProfile): Activity[] {
  const recent = p.activities.map<Activity>((a, i) => ({
    id: `${p.providerId}-mock-activity-${i}`,
    providerId: p.providerId,
    sessionId: null,
    project: a.project,
    type: a.type,
    message: a.message,
    timestamp: t0 - a.msAgo,
    source: 'local' as const,
  }));

  return [...recent, ...backfill(p)];
}

/**
 * Six days of prior activity behind the detailed recent feed.
 *
 * Without it the 7-day plot is one column and six blanks, and the panel looks
 * unfinished in exactly the place it is meant to show a shape. The volumes
 * follow a plausible working week — a quiet weekend, a Thursday peak — and
 * are deterministic so a screenshot is reproducible.
 */
function backfill(p: MockProfile): Activity[] {
  // Index 0 is yesterday, counting backwards. Codex and Claude differ so the
  // split in the day rollup is never a flat 50/50.
  const shape =
    p.providerId === 'codex' ? [5, 2, 9, 4, 3, 1] : [3, 1, 6, 5, 2, 1];

  const templates: Array<{ type: ActivityType; message: string }> = [
    { type: 'session-started', message: 'Session started' },
    { type: 'file-edited', message: 'Edited source files' },
    { type: 'task-completed', message: 'Task completed' },
    { type: 'session-completed', message: 'Session finished' },
    { type: 'command-run', message: 'Ran build' },
  ];

  // Weighted toward the provider's main project, the way real work clusters.
  const primary = p.sessions[0]?.project ?? 'project';
  const secondary = p.sessions[1]?.project ?? primary;
  const projects: string[] = [primary, primary, primary, secondary, primary, 'open-source'];
  const out: Activity[] = [];

  shape.forEach((count, dayBack) => {
    for (let i = 0; i < count; i += 1) {
      const template = templates[(dayBack + i) % templates.length];
      // Spread across a working day so nothing clusters at one timestamp.
      const hourOffset = (10 + ((dayBack * 3 + i * 2) % 9)) * HOUR;
      out.push({
        id: `${p.providerId}-mock-backfill-${dayBack}-${i}`,
        providerId: p.providerId,
        sessionId: null,
        project: projects[(dayBack * 2 + i) % projects.length] ?? null,
        type: template.type,
        message: template.message,
        timestamp: startOfDaysAgo(dayBack + 1) + hourOffset,
        source: 'local',
      });
    }
  });

  return out;
}

function startOfDaysAgo(days: number): number {
  const d = new Date(t0 - days * DAY);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
