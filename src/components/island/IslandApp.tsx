import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Island } from './Island';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { silenceNotifications } from '@/lib/notify';
import { invokeSafe, isTauri } from '@/lib/tauri';

/**
 * The island's own window. It keeps its own copy of the data, refreshed by
 * the same file-change events as the panel, and stays silent: the panel's
 * window is the one that sends notifications.
 */
export function IslandApp() {
  const [expanded, setExpanded] = useState(false);
  const refresh = useApp((s) => s.refresh);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    // The island is always the dark pill, whatever the panel's theme.
    document.documentElement.setAttribute('data-theme', 'dark');
    silenceNotifications();
    void (async () => {
      await loadSettings();
      await refresh();
    })();
  }, [loadSettings, refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = [
      listen('provider://changed', () => void refresh()),
      // Hover is tracked natively: macOS does not reliably tell an inactive
      // app's window that the pointer is over it.
      listen<boolean>('island://hover', (e) => setExpanded(e.payload)),
    ];
    return () => {
      for (const u of unlisten) void u.then((fn) => fn());
    };
  }, [refresh]);

  return (
    <Island
      expanded={expanded}
      onOpenPanel={() => void invokeSafe<void>('show_panel', undefined, undefined)}
    />
  );
}
