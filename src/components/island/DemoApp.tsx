import { useEffect, useState } from 'react';
import { Island } from './Island';
import { Panel } from '@/components/Panel';
import { AppToaster } from '@/components/AppToaster';
import { usePanelLifecycle } from '@/hooks/usePanelLifecycle';
import { useTheme } from '@/hooks/useTheme';
import { useSetting, useSettings } from '@/store/settings';
import { useApp } from '@/store/app';
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
  const islandMode = useSetting('islandMode');

  // "On hover": the island stays away until the cursor reaches the top
  // centre of the page, as it does at the top of the screen on the desktop.
  useEffect(() => {
    if (islandMode !== 'hover') return;
    const onMove = (e: PointerEvent) => {
      if (e.clientY <= 6 && Math.abs(e.clientX - window.innerWidth / 2) <= 190) setHover(true);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [islandMode]);

  // Leaving the page altogether (out of the top of a preview frame, say)
  // fires no pointerleave on the card, so close it from the page too.
  useEffect(() => {
    const close = () => setHover(false);
    document.documentElement.addEventListener('mouseleave', close);
    window.addEventListener('blur', close);
    return () => {
      document.documentElement.removeEventListener('mouseleave', close);
      window.removeEventListener('blur', close);
    };
  }, []);

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
      {islandMode !== 'off' && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[440px]">
          <Island
            expanded={hover}
            present={islandMode === 'always' || hover}
            onHover={setHover}
            onClose={() => {
              setHover(false);
              useSettings.getState().set('islandMode', 'off');
            }}
            onOpenPanel={(agentId) => {
              setHover(false);
              setPanelOpen(true);
              if (agentId) useApp.getState().focusAgent(agentId);
            }}
          />
        </div>
      )}
      <AppToaster />
    </>
  );
}
