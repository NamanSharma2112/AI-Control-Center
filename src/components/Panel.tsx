import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { usePrefersReducedMotion } from '@/hooks/useReducedMotion';
import { useTicker } from '@/hooks/useTicker';
import { panelVariants, resolveIntensity, routeVariants } from '@/lib/motion';
import { providerSeries, runningCount, sessionSeries, seriesTotal } from '@/lib/insights';
import { CATEGORIES, type CategoryId } from '@/lib/categories';
import { formatCountdown } from '@/lib/time';
import { MetricCard } from './MetricCard';
import { Console } from './Console';
import { SettingsPane } from './SettingsPane';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ProvenanceTag } from '@/components/ui/ProvenanceTag';
import { PROVIDER_WORD } from '@/components/ui/StatusDot';
import type { ProviderId, ProviderSnapshot } from '@/types/domain';
import { cn } from '@/lib/cn';

/** Fixed console height. The agent list scrolls inside it; the frame never jumps. */
const PANEL_HEIGHT = 640;

/**
 * The console: categories on the left, the answer and the agents on the right.
 *
 * It floats a short distance from the screen edge it was summoned from, and
 * slides in from that edge. Hovering a category anywhere — a card, a bar
 * segment, a legend item — lights it everywhere else, so the two columns read
 * as one surface.
 */
export function Panel({ open = true }: { open?: boolean }) {
  const route = useApp((s) => s.route);
  const summon = useApp((s) => s.summon);
  const snapshots = useApp((s) => s.snapshots);
  const sessions = useApp((s) => s.sessions);
  const activities = useApp((s) => s.activities);
  const history = useApp((s) => s.history);

  const settings = useSettings((s) => s.settings);
  const prefersReduced = usePrefersReducedMotion();
  const intensity = resolveIntensity(settings.motionIntensity, prefersReduced);

  // The entrance (charts drawing, bars revealing) belongs to an edge open.
  // A keyboard toggle is high-frequency, so its answer is on screen at once.
  const entrance = intensity === 'full' && summon !== 'shortcut';
  const live = intensity !== 'none' && !prefersReduced;

  const working = sessions.some((s) => s.status === 'running' || s.status === 'waiting');
  const now = useTicker(working);

  const [focus, setFocus] = useState<CategoryId | null>(null);

  // Slide from fully off screen: the panel's width plus the gap to the edge
  // plus room for its shadow, so no sliver is visible before it moves.
  const variants = useMemo(
    () => panelVariants(settings.edge, intensity, summon, settings.panelWidth + 48),
    [settings.edge, intensity, summon, settings.panelWidth],
  );
  const routeVars = useMemo(() => routeVariants(intensity), [intensity]);
  const onRight = settings.edge === 'right';
  const direction = route === 'settings' ? 1 : -1;

  const claudeSeries = useMemo(() => providerSeries(history, 'claude-code'), [history]);
  const codexSeries = useMemo(() => providerSeries(history, 'codex'), [history]);
  const agentSeries = useMemo(() => sessionSeries(activities), [activities]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route]);

  const providerCard = (id: ProviderId, form: 'bars' | 'area', series: typeof claudeSeries) => {
    const snapshot = snapshots.find((s) => s.provider.id === id);
    return (
      <ProviderMetric
        key={id}
        id={id}
        snapshot={snapshot}
        series={series}
        form={form}
        animate={entrance}
        countUp={intensity === 'full'}
        now={now}
        focus={focus}
        onFocus={setFocus}
      />
    );
  };

  const needsYou = sessions.filter((s) => s.status === 'waiting').length;
  const running = runningCount(sessions);

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 flex items-center p-4 sm:p-5',
        onRight ? 'justify-end' : 'justify-start',
      )}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            variants={variants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              width: settings.panelWidth,
              height: PANEL_HEIGHT,
              boxShadow: 'var(--shadow-panel)',
            }}
            className="@container pointer-events-auto flex max-h-full max-w-full flex-col overflow-hidden rounded-panel bg-panel"
          >
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 @min-[720px]:overflow-hidden"
            >
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={route}
                  custom={direction}
                  variants={routeVars}
                  initial="enter"
                  animate="center"
                  exit="leave"
                  className="flex flex-col @min-[720px]:h-full @min-[720px]:min-h-0"
                >
                  {route === 'settings' ? (
                    <div className="flex flex-col p-2 @min-[720px]:h-full @min-[720px]:min-h-0">
                      <SettingsPane />
                    </div>
                  ) : (
                    <div className="grid gap-4 @min-[720px]:h-full @min-[720px]:min-h-0 @min-[720px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div className="flex flex-col gap-2.5 @min-[720px]:min-h-0 [&>section]:min-h-[164px]">
                        {providerCard('claude-code', 'bars', claudeSeries)}
                        {providerCard('codex', 'area', codexSeries)}
                        <MetricCard
                          category={CATEGORIES.agents}
                          figure={<AnimatedNumber value={seriesTotal(agentSeries)} animate={intensity === 'full'} />}
                          unit={seriesTotal(agentSeries) === 1 ? 'session' : 'sessions'}
                          detail={
                            running + needsYou === 0 ? (
                              'None running now'
                            ) : (
                              <>
                                {running} running
                                {needsYou > 0 && (
                                  <>
                                    {' · '}
                                    <span className="text-warn">{needsYou} need you</span>
                                  </>
                                )}
                              </>
                            )
                          }
                          series={agentSeries}
                          form="lollipop"
                          chartUnit="sessions"
                          animate={entrance}
                          highlighted={focus === 'agents'}
                          dimmed={focus !== null && focus !== 'agents'}
                          onHoverChange={(h) => setFocus(h ? 'agents' : null)}
                        />
                      </div>

                      <div className="flex min-h-[520px] min-w-0 flex-col px-2 pt-2 @min-[720px]:min-h-0">
                        <Console
                          focus={focus}
                          onFocus={setFocus}
                          animate={entrance}
                          live={live}
                          intensity={intensity}
                          now={now}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A provider's metric card: usage left as the figure, its week as the chart. */
function ProviderMetric({
  id,
  snapshot,
  series,
  form,
  animate,
  countUp,
  now,
  focus,
  onFocus,
}: {
  id: ProviderId;
  snapshot: ProviderSnapshot | undefined;
  series: ReturnType<typeof providerSeries>;
  form: 'bars' | 'area';
  animate: boolean;
  countUp: boolean;
  now: number;
  focus: CategoryId | null;
  onFocus: (id: CategoryId | null) => void;
}) {
  const category = CATEGORIES[id];
  const usage = snapshot?.usage ?? null;
  const connected = snapshot?.provider.connected ?? false;
  const remaining = usage ? Math.max(0, 100 - usage.percentage) : null;
  const low = remaining !== null && remaining <= 25;

  return (
    <MetricCard
      category={category}
      status={snapshot ? PROVIDER_WORD[snapshot.provider.status] : undefined}
      figure={
        remaining !== null ? (
          <>
            <AnimatedNumber value={remaining} animate={countUp} />
            {/* The unit is set smaller so the number carries the weight. */}
            <span className="ml-0.5 text-[0.62em] font-medium tracking-normal">%</span>
          </>
        ) : (
          <span className="text-text-3">—</span>
        )
      }
      unit={
        remaining !== null ? (
          <>
            <span className={cn(low && 'text-warn')}>left</span>{' '}
            <ProvenanceTag source={usage?.source ?? 'local'} />
          </>
        ) : (
          ''
        )
      }
      detail={
        !connected
          ? 'Not connected'
          : !usage
            ? snapshot?.provider.statusDetail ?? 'No usage limit reported'
            : usage.resetAt
              ? `Resets in ${formatCountdown(usage.resetAt, now)}`
              : 'Reset time unknown'
      }
      series={series}
      form={form}
      chartUnit="actions"
      animate={animate}
      highlighted={focus === id}
      dimmed={focus !== null && focus !== id}
      onHoverChange={(h) => onFocus(h ? id : null)}
    />
  );
}
