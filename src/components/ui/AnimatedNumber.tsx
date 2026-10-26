import { memo } from 'react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

/**
 * A number that tweens to its value, isolated in its own leaf.
 *
 * This component exists for a performance reason, not a styling one: the tween
 * runs on rAF and sets state every frame, so whatever holds it re-renders at
 * 60fps. Keeping it a leaf means a provider card's meter, labels and status do
 * not re-render while its percentage settles.
 */
export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  animate = true,
  suffix = '',
}: {
  value: number;
  animate?: boolean;
  suffix?: string;
}) {
  const shown = useAnimatedNumber(value, animate);
  return (
    <>
      {Math.round(shown)}
      {suffix}
    </>
  );
});
