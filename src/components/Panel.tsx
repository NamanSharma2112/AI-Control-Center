import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { usePrefersReducedMotion } from '@/hooks/useReducedMotion';
import { panelVariants, resolveIntensity, routeVariants } from '@/lib/motion';
import { PanelHeader } from './PanelHeader';
import { Dashboard } from './Dashboard';
import { SettingsPane } from './SettingsPane';
import { NotificationStack } from './NotificationStack';
import { cn } from '@/lib/cn';

/**
 * The faceplate.
 *
 * Attached to a screen edge rather than floating near it: the outer radius is
 * square on the attached side and rounded on the free side, and the shadow is
 * cast away from the edge. That one detail is what makes it read as part of
 * the screen's furniture instead of a window that happens to be there.
 */
export function Panel({ open = true }: { open?: boolean }) {
  const route = useApp((s) => s.route);
  const summon = useApp((s) => s.summon);
  const notifications = useApp((s) => s.notifications);
  const dismiss = useApp((s) => s.dismissNotification);

  const settings = useSettings((s) => s.settings);
  const prefersReduced = usePrefersReducedMotion();
  const intensity = resolveIntensity(settings.motionIntensity, prefersReduced);

  const variants = useMemo(
    () => panelVariants(settings.edge, intensity, summon),
    [settings.edge, intensity, summon],
  );
  const routeVars = useMemo(() => routeVariants(intensity), [intensity]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Each face starts at its own top; carrying a scroll position across the
  // two reads as a glitch.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route]);

  const onRight = settings.edge === 'right';
  const direction = route === 'settings' ? 1 : -1;

  return (
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
            boxShadow: onRight
              ? 'var(--shadow-panel-right)'
              : 'var(--shadow-panel-left)',
          }}
          className={cn(
            'fixed inset-y-0 flex h-full flex-col overflow-hidden bg-surface-1',
            onRight
              ? 'right-0 rounded-l-panel'
              : 'left-0 rounded-r-panel',
          )}
        >
          <PanelHeader />

          <NotificationStack
            notifications={notifications}
            onDismiss={dismiss}
            intensity={intensity}
          />

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={route}
                custom={direction}
                variants={routeVars}
                initial="enter"
                animate="center"
                exit="leave"
              >
                {route === 'dashboard' ? <Dashboard /> : <SettingsPane />}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
