import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Element size via ResizeObserver.
 *
 * Used where motion needs a real number: Motion can animate a fixed height to
 * `auto` but not `auto` to `auto`, so an expanding card animates to its
 * measured height instead. Charts use it to draw in true pixels, which keeps
 * circles round and hairlines one pixel wide at any panel width.
 */
export function useMeasure<T extends HTMLElement>(): [
  (node: T | null) => void,
  { width: number; height: number },
] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const ref = useCallback((el: T | null) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, size];
}
