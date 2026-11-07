import { useEffect, useState } from 'react';
import { Island } from './Island';
import { Panel } from '@/components/Panel';
import { AppToaster } from '@/components/AppToaster';
import { usePanelLifecycle } from '@/hooks/usePanelLifecycle';
import { useTheme } from '@/hooks/useTheme';
import { useSetting } from '@/store/settings';
import { showToast } from '@/lib/notify';

/**
 * A browser preview of the whole product on one page: the island at the top
 * of a pretend desktop, and the full panel one click away. In the desktop app
 * these are two windows; here hover comes from the page itself.
 */
export function DemoApp() {
  const theme = useSetting('theme');
  useTheme(theme);
  usePanelLifecycle();

  const [hover, setHover] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Lets a scripted walkthrough (the intro video) raise a notice on cue.
  useEffect(() => {
    (window as unknown as { __accToast?: typeof showToast }).__accToast = showToast;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {panelOpen && (
        // Click-away closes the panel, as it does on the desktop.
        <div className="fixed inset-0" onClick={() => setPanelOpen(false)} aria-hidden="true" />
      )}
      <Panel open={panelOpen} />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[440px]">
        <Island
          expanded={hover}
          onHover={setHover}
          onOpenPanel={() => {
            setHover(false);
            setPanelOpen(true);
          }}
        />
      </div>
      <AppToaster />
    </>
  );
}
