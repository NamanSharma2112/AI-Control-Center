import type { Transition, Variants } from 'motion/react';
import type { EdgeSide, MotionIntensity } from '@/store/settings';

/**
 * Motion system.
 *
 * Thesis — the panel is an instrument taking a reading. The one authored
 * moment is arrival: the faceplate slides in from the screen edge on a spring
 * that settles without overshooting past the edge it is attached to, and the
 * meters calibrate from zero to their value immediately behind it. That
 * sequence plays on open and never again; a later data change updates a value
 * quietly, because a re-running entrance would be theatre.
 *
 * Continuity — route changes between dashboard and settings move horizontally
 * so the two read as adjacent faces of one panel, not two pages.
 * Feedback — hover and press are opacity and background only, at most 1px of
 * movement, because this surface is read, not explored.
 * Budget — transform/opacity only on the moving parts; nothing animates at
 * rest, which is what keeps the app free while it sits in the tray.
 */

/** Arrival. Settles without bouncing back past the attached edge. */
export const PANEL_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 36,
  mass: 0.9,
};

/** Departure is faster than arrival: dismissal should feel like a release. */
export const PANEL_EXIT: Transition = {
  duration: 0.14,
  ease: [0.32, 0.72, 0, 1],
};

export const VALUE_TRANSITION: Transition = {
  duration: 0.42,
  ease: [0.16, 1, 0.3, 1],
};

export const STATE_TRANSITION: Transition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

/** Stagger is capped so a long feed never delays the last row past ~130ms. */
const STAGGER_STEP = 0.018;
const STAGGER_CAP = 7;

export function panelVariants(edge: EdgeSide, intensity: MotionIntensity): Variants {
  const offscreen = edge === 'right' ? '100%' : '-100%';
  const exitNudge = edge === 'right' ? 16 : -16;

  if (intensity === 'none') {
    return {
      hidden: { opacity: 0, x: 0 },
      visible: { opacity: 1, x: 0, transition: { duration: 0 } },
      exit: { opacity: 0, x: 0, transition: { duration: 0 } },
    };
  }

  if (intensity === 'reduced') {
    return {
      hidden: { opacity: 0, x: 0 },
      visible: { opacity: 1, x: 0, transition: { duration: 0.12 } },
      exit: { opacity: 0, x: 0, transition: { duration: 0.1 } },
    };
  }

  return {
    hidden: { opacity: 0, x: offscreen },
    visible: {
      opacity: 1,
      x: 0,
      transition: { ...PANEL_SPRING, opacity: { duration: 0.12 } },
    },
    exit: {
      opacity: 0,
      x: exitNudge,
      transition: PANEL_EXIT,
    },
  };
}

/** Section entrance, riding the panel's arrival once. */
export function sectionVariants(intensity: MotionIntensity): Variants {
  if (intensity !== 'full') {
    return {
      hidden: { opacity: 1, y: 0 },
      visible: { opacity: 1, y: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 6 },
    visible: (index: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: Math.min(index, STAGGER_CAP) * STAGGER_STEP,
        duration: 0.26,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  };
}

/** Route change between the two faces of the panel. */
export function routeVariants(intensity: MotionIntensity): Variants {
  if (intensity !== 'full') {
    return {
      enter: { opacity: 1, x: 0 },
      center: { opacity: 1, x: 0 },
      leave: { opacity: 0, x: 0 },
    };
  }
  return {
    enter: (dir: number) => ({ opacity: 0, x: dir * 18 }),
    center: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
    },
    leave: (dir: number) => ({
      opacity: 0,
      x: dir * -18,
      transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] },
    }),
  };
}

export const NOTIFICATION_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.13 } },
};

export function resolveIntensity(
  setting: MotionIntensity,
  prefersReduced: boolean,
): MotionIntensity {
  if (prefersReduced) return setting === 'none' ? 'none' : 'reduced';
  return setting;
}
