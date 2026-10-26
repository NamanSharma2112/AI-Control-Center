import { Fragment, useMemo } from 'react';
import { motion } from 'motion/react';
import { useApp } from '@/store/app';
import { useSetting } from '@/store/settings';
import { usePrefersReducedMotion } from '@/hooks/useReducedMotion';
import { useTicker } from '@/hooks/useTicker';
import { resolveIntensity, sectionVariants } from '@/lib/motion';
import { activeSessions, todaysActivities } from '@/lib/derive';
import { ProviderCard } from './ProviderCard';
import { SessionRow } from './SessionRow';
import { Timeline } from './Timeline';
import { UsageHistory } from './UsageHistory';
import { ProjectBreakdown } from './ProjectBreakdown';
import { TodaySummary } from './TodaySummary';
import { SectionHeader, Rule } from '@/components/ui/SectionHeader';
import { ProvenanceTag } from '@/components/ui/ProvenanceTag';

/**
 * The dashboard answers the product's three questions in order: how much is
 * left, what is running now, what happened recently. Everything after the
 * third is supporting context and sits below it.
 */
export function Dashboard() {
  const snapshots = useApp((s) => s.snapshots);
  const sessions = useApp((s) => s.sessions);
  const activities = useApp((s) => s.activities);
  const history = useApp((s) => s.history);
  const projects = useApp((s) => s.projects);
  const today = useApp((s) => s.today);

  const motionSetting = useSetting('motionIntensity');
  const prefersReduced = usePrefersReducedMotion();
  const intensity = resolveIntensity(motionSetting, prefersReduced);
  const animate = intensity === 'full';

  const active = useMemo(() => activeSessions(sessions), [sessions]);
  const timeline = useMemo(() => todaysActivities(activities), [activities]);

  // One shared clock, and only while something is actually counting.
  const now = useTicker(active.length > 0);

  const variants = useMemo(() => sectionVariants(intensity), [intensity]);
  let step = 0;
  const section = () => ({
    variants,
    custom: step++,
    initial: animate ? ('hidden' as const) : false,
    animate: 'visible' as const,
  });

  return (
    <div className="flex flex-col">
      <motion.section {...section()} aria-labelledby="sec-usage">
        {/* No section-level provenance here: each row carries its own, and a
            second tag at this level would have to speak for both. */}
        <SectionHeader className="pt-3">
          <span id="sec-usage">Provider usage</span>
        </SectionHeader>
        <div className="divide-y divide-rule">
          {snapshots.map((snapshot) => (
            <ProviderCard
              key={snapshot.provider.id}
              snapshot={snapshot}
              animate={animate}
              now={now}
            />
          ))}
        </div>
      </motion.section>

      <Rule />

      <motion.section {...section()} aria-labelledby="sec-agents">
        <SectionHeader
          trailing={
            active.length > 0 ? (
              <span className="t-meta text-text-3 tabular-nums">{active.length}</span>
            ) : null
          }
        >
          <span id="sec-agents">Active agents</span>
        </SectionHeader>
        {active.length > 0 ? (
          <div>
            {active.map((session) => (
              <SessionRow key={session.id} session={session} now={now} />
            ))}
          </div>
        ) : (
          <p className="t-meta px-3.5 pb-3 text-text-3">
            No agents running. Start one and it appears here.
          </p>
        )}
      </motion.section>

      <Rule />

      <motion.section {...section()} aria-labelledby="sec-today">
        <SectionHeader>
          <span id="sec-today">Today</span>
        </SectionHeader>
        <TodaySummary today={today} animate={animate} />
      </motion.section>

      <Rule />

      <motion.section {...section()} aria-labelledby="sec-recent">
        <SectionHeader>
          <span id="sec-recent">Recent activity</span>
        </SectionHeader>
        <Timeline activities={timeline.length > 0 ? timeline : activities} />
      </motion.section>

      <Rule />

      <motion.section {...section()} aria-labelledby="sec-history">
        <SectionHeader trailing={<ProvenanceTag source="local" />}>
          <span id="sec-history">7-day activity</span>
        </SectionHeader>
        <UsageHistory history={history} animate={animate} />
      </motion.section>

      <Rule />

      <motion.section {...section()} aria-labelledby="sec-projects">
        <SectionHeader trailing={<ProvenanceTag source="local" />}>
          <span id="sec-projects">Projects</span>
        </SectionHeader>
        <ProjectBreakdown projects={projects} animate={animate} />
      </motion.section>

      <Fragment />
    </div>
  );
}
