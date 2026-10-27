import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { useUpdates } from '@/store/updates';
import type { SummonSource } from '@/lib/motion';
import { invokeSafe, isTauri } from '@/lib/tauri';

/**
 * Wires the webview to the Rust shell.
 *
 * Everything here is event-driven: the panel refreshes when the shell says
 * something changed or when it is shown, never on a timer. An idle app
 * schedules no work at all, which is the whole performance budget.
 */
export function usePanelLifecycle(): void {
  const refresh = useApp((s) => s.refresh);
  const setRoute = useApp((s) => s.setRoute);
  const setSummon = useApp((s) => s.setSummon);
  const loadSettings = useSettings((s) => s.load);

  // Boot: restore preferences, take the first reading, then (if allowed)
  // check for an update once. A found update is announced once, in the panel.
  useEffect(() => {
    void (async () => {
      await loadSettings();
      await refresh();
      if (!useSettings.getState().settings.onboarded && isTauri()) {
        setRoute('welcome');
        await invokeSafe<void>('show_panel', undefined, undefined);
      }
      if (!useSettings.getState().settings.checkForUpdates) return;
      await useUpdates.getState().check();
      const update = useUpdates.getState().state;
      if (update.kind === 'available') {
        useApp.getState().announce({
          id: `update:${update.version}`,
          kind: 'session',
          severity: 'info',
          title: `Version ${update.version} is available`,
          detail: 'Install it from Settings',
          providerId: null,
          timestamp: Date.now(),
          read: false,
        });
      }
    })();
  }, [loadSettings, refresh, setRoute]);

  // Push the restored layout and shortcut down to the shell once.
  useEffect(() => {
    if (!isTauri()) return;
    const unsubscribe = useSettings.subscribe((state, prev) => {
      if (!state.loaded || prev.loaded) return;
      const s = state.settings;
      void invokeSafe<void>(
        'apply_window_layout',
        { edge: s.edge, width: s.panelWidth },
        undefined,
      );
      void invokeSafe<void>('set_shortcut', { accelerator: s.shortcut }, undefined);
      void invokeSafe<void>(
        'set_edge_config',
        { sensitivity: s.edgeSensitivity, dwellMs: s.edgeDwellMs },
        undefined,
      );
      void invokeSafe<void>(
        'set_edge_watch',
        { enabled: s.edgeActivationEnabled },
        undefined,
      );
    });
    return unsubscribe;
  }, []);

  // The shell tells us when to re-read: on show, and on a watched file change.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisteners: Array<Promise<() => void>> = [
      listen<string>('panel://shown', (event) => {
        // The shell says how it was summoned; a keyboard toggle skips the
        // entrance so the answer is on screen the instant the key is pressed.
        setSummon(isSummonSource(event.payload) ? event.payload : 'edge');
        if (useSettings.getState().settings.onboarded) setRoute('dashboard');
        else setRoute('welcome');
        void refresh();
      }),
      listen('panel://settings', () => {
        setRoute('settings');
      }),
      listen('provider://changed', () => {
        void refresh();
      }),
    ];
    return () => {
      for (const u of unlisteners) void u.then((fn) => fn());
    };
  }, [refresh, setRoute, setSummon]);

  // Escape dismisses. In a browser preview there is no window to hide, so the
  // key simply does nothing rather than throwing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void invokeSafe<void>('hide_panel', undefined, undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clicking away dismisses. The shell also watches focus loss, but a
  // webview-side blur is the faster of the two.
  useEffect(() => {
    if (!isTauri()) return;
    const onBlur = () => void invokeSafe<void>('hide_panel', undefined, undefined);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);
}

function isSummonSource(value: unknown): value is SummonSource {
  return value === 'edge' || value === 'shortcut' || value === 'tray';
}
