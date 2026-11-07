import { Toaster } from 'sonner';
import { useSetting } from '@/store/settings';

/** Toasts, styled from the same tokens as the panel. */
export function AppToaster() {
  const theme = useSetting('theme');
  return (
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
  );
}
