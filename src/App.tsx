import { Panel } from '@/components/Panel';
import { AppToaster } from '@/components/AppToaster';
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
      <AppToaster />
    </>
  );
}
