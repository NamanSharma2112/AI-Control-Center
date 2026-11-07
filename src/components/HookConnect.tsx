import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { ProviderId } from '@/types/domain';
import { CATEGORIES } from '@/lib/categories';
import { invokeSafe, invokeStrict, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/cn';

interface HookStatus {
  agentFound: boolean;
  installed: boolean;
  stale: boolean;
  problem: string | null;
}

const WHAT: Record<ProviderId, string> = {
  'claude-code': 'Tells you the moment it needs permission or finishes',
  codex: 'Tells you the moment it finishes a turn',
};

const WHERE: Record<ProviderId, string> = {
  'claude-code': '~/.claude/settings.json',
  codex: '~/.codex/config.toml',
};

/**
 * Connects an agent's own notification hook to this app. It edits the
 * agent's config file, so it happens only on this explicit click, says which
 * file, and can be undone the same way.
 */
export function HookConnect({ id }: { id: ProviderId }) {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const cat = CATEGORIES[id];

  const load = useCallback(async () => {
    setStatus(await invokeSafe<HookStatus | null>('hook_status', { provider: id }, null));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (install: boolean) => {
    setBusy(true);
    try {
      await invokeStrict<void>(install ? 'install_hooks' : 'uninstall_hooks', { provider: id });
      toast.success(
        install ? `${cat.label} alerts connected` : `${cat.label} alerts disconnected`,
        { description: install ? `Updated ${WHERE[id]}. A backup of the original is beside it.` : undefined },
      );
    } catch (cause) {
      toast.error(`Could not update ${cat.label}`, { description: String(cause) });
    } finally {
      setBusy(false);
      void load();
    }
  };

  const connected = status?.installed && !status.stale;
  const hint = !isTauri()
    ? 'Needs the desktop app'
    : status === null
      ? 'Checking…'
      : !status.agentFound
        ? `${cat.label} is not set up on this computer`
        : status.problem
          ? status.problem
          : status.stale
            ? 'Set up for an older copy of this app. Reconnect to fix'
            : connected
              ? `Connected · ${WHAT[id].replace('Tells you', 'tells you')}`
              : WHAT[id];

  const canAct = isTauri() && !!status?.agentFound && !status.problem && !busy;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <cat.icon size={15} strokeWidth={2} className={cat.text} />
        <div className="min-w-0">
          <p className="t-body flex items-center gap-1.5 text-text-1">
            {cat.label}
            {connected && <Zap size={12} strokeWidth={2.2} className="text-ok" aria-label="connected" />}
          </p>
          <p className="t-caption mt-0.5 text-text-2">{hint}</p>
        </div>
      </div>
      <button
        type="button"
        disabled={!canAct}
        onClick={() => void act(!connected)}
        className={cn(
          't-label flex h-8 shrink-0 items-center rounded-full px-3.5 whitespace-nowrap transition-colors duration-100 disabled:opacity-45',
          connected
            ? 'border border-rule-strong text-text-1 enabled:hover:bg-card-hover'
            : 'bg-primary text-primary-fg enabled:hover:bg-primary-hover',
        )}
      >
        {busy ? 'Working…' : connected ? 'Disconnect' : status?.stale ? 'Reconnect' : 'Connect'}
      </button>
    </div>
  );
}
