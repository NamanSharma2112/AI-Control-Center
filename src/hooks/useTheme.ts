import { useEffect } from 'react';
import type { ThemeMode } from '@/store/settings';

/**
 * Applies the theme to the document root. `system` follows the OS live, so a
 * machine flipping to dark at sunset takes the panel with it.
 */
export function useTheme(mode: ThemeMode): void {
  useEffect(() => {
    const root = document.documentElement;

    if (mode !== 'system') {
      root.setAttribute('data-theme', mode);
      return;
    }

    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = (light: boolean) =>
      root.setAttribute('data-theme', light ? 'light' : 'dark');

    apply(query.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);
}
