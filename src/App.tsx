import { Toaster } from 'sonner';
import { Panel } from '@/components/Panel';
import { usePanelLifecycle } from '@/hooks/usePanelLifecycle';
import { useTheme } from '@/hooks/useTheme';
import { useSetting } from '@/store/settings';

export default function App() {
  const theme = useSetting('theme');
  useTheme(theme);
  usePanelLifecycle();

  return (
    <>
      <Panel />
      {/* Toasts sit inside the panel's own window, centred over its lower
          edge, styled from the same tokens as the panel. */}
      <Toaster
        position="bottom-center"
        offset={36}
        theme={theme}
        gap={8}
        visibleToasts={3}
        toastOptions={{
          style: {
            background: 'var(--surface-row-selected)',
            border: '1px solid var(--row-border)',
            color: 'var(--text-1)',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-tooltip)',
          },
          // Icons take their state colour; everything else stays neutral.
          classNames: {
            description: '!text-text-2',
            warning: '[&_[data-icon]]:!text-warn',
            error: '[&_[data-icon]]:!text-error',
            success: '[&_[data-icon]]:!text-ok',
          },
        }}
      />
    </>
  );
}
