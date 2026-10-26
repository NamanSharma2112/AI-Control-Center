import { ArrowLeft, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, type Tone } from '@/components/ui/StatusDot';
import { useApp } from '@/store/app';
import { formatRelative } from '@/lib/time';

const TONE: Record<'ok' | 'warn' | 'error' | 'idle', Tone> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  idle: 'idle',
};

/**
 * The panel's nameplate. The system line beside it is the panel's one
 * promise — it says "all systems operational" only when that is true, and
 * otherwise names what is wrong.
 */
export function PanelHeader() {
  const route = useApp((s) => s.route);
  const setRoute = useApp((s) => s.setRoute);
  const system = useApp((s) => s.system);
  const refreshing = useApp((s) => s.refreshing);
  const refresh = useApp((s) => s.refresh);
  const lastRefreshedAt = useApp((s) => s.lastRefreshedAt);

  const isSettings = route === 'settings';

  return (
    <header className="flex items-center gap-2 border-b border-rule px-3.5 py-2.5">
      {isSettings && (
        <IconButton
          icon={ArrowLeft}
          label="Back to dashboard"
          onClick={() => setRoute('dashboard')}
          className="-ml-1"
        />
      )}

      <div className="min-w-0 flex-1">
        <h1 className="t-value text-text-1">
          {isSettings ? 'Settings' : 'AI Control Center'}
        </h1>
        {isSettings ? (
          <p className="t-meta mt-px text-text-3">
            {lastRefreshedAt ? `Updated ${formatRelative(lastRefreshedAt)}` : 'Local-first'}
          </p>
        ) : (
          <div className="mt-px flex items-center gap-1.5">
            <StatusDot tone={TONE[system.tone]} live={system.tone === 'ok'} />
            <p className="t-meta truncate text-text-2">{system.label}</p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          icon={RefreshCw}
          label="Refresh provider data"
          onClick={() => void refresh()}
          spinning={refreshing}
          disabled={refreshing}
        />
        {!isSettings && (
          <IconButton
            icon={SettingsIcon}
            label="Settings"
            onClick={() => setRoute('settings')}
          />
        )}
      </div>
    </header>
  );
}
