import { useEffect, useState } from 'react';
import type { ProviderId } from '@/types/domain';
import { useSettings } from '@/store/settings';
import { useApp } from '@/store/app';
import { CATEGORIES } from '@/lib/categories';
import { cn } from '@/lib/cn';

/** What one unit of each provider's limit is, in the user's words. */
export const LIMIT_UNIT: Record<ProviderId, string> = {
  'claude-code': 'tokens per 5 hours',
  codex: 'requests per week',
};

/**
 * A provider's usage ceiling.
 *
 * Neither provider lets other apps read plan limits, and guessing them would
 * put invented numbers on screen. So the user sets the ceiling — and since
 * almost nobody knows their plan in tokens, the easy path is calibration: the
 * moment you hit your limit, one click sets it to what you have used.
 */
export function LimitEditor({ id }: { id: ProviderId }) {
  const cap = useSettings((s) => s.settings.caps[id]);
  const setCap = useSettings((s) => s.setCap);
  const refresh = useApp((s) => s.refresh);
  const used = useApp((s) => s.snapshots.find((x) => x.provider.id === id)?.usage?.used ?? 0);
  const [draft, setDraft] = useState(String(cap));
  const [calibrated, setCalibrated] = useState(false);

  useEffect(() => setDraft(String(cap)), [cap]);

  const commit = () => {
    const n = Number(draft.replace(/[^\d]/g, ''));
    if (Number.isFinite(n) && n > 0) {
      setCap(id, n);
      void refresh();
    } else {
      setDraft(String(cap));
    }
  };

  const inputId = `cap-${id}`;
  return (
    <div className="space-y-2 px-4 py-2.5">
      <label htmlFor={inputId} className="t-body flex items-center gap-2 text-text-1">
        {CATEGORIES[id].label} limit
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          inputMode="numeric"
          value={Number(draft || 0).toLocaleString()}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          className="t-mono selectable h-8 w-32 rounded-md border border-row-border bg-inset px-2.5 text-text-1 outline-none transition-colors duration-100 focus:border-focus"
        />
        <span className="t-caption text-text-2">{LIMIT_UNIT[id]}</span>
      </div>
      <button
        type="button"
        disabled={used <= 0}
        onClick={() => {
          setCap(id, Math.max(1, used));
          setCalibrated(true);
          window.setTimeout(() => setCalibrated(false), 2000);
          void refresh();
        }}
        className={cn(
          't-caption text-left underline decoration-rule-strong underline-offset-2 transition-colors duration-100',
          'enabled:hover:text-text-1 disabled:no-underline disabled:opacity-60',
          calibrated ? 'text-ok' : 'text-text-2',
        )}
      >
        {calibrated
          ? 'Limit set to your current usage'
          : used > 0
            ? `Just hit your limit? Set it to current usage (${used.toLocaleString()})`
            : 'Once you have used it, you can set this from your current usage'}
      </button>
    </div>
  );
}
