import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Check, CircleDashed, MousePointer2, ShieldCheck } from 'lucide-react';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { PROVIDER_IDS } from '@/providers/registry';
import { CATEGORIES } from '@/lib/categories';
import { Toggle } from '@/components/ui/Field';
import { LimitEditor } from './LimitEditor';
import { formatAccelerator } from './ShortcutRecorder';
import { invokeSafe, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/cn';

const WHERE: Record<string, string> = {
  'claude-code': '~/.claude/projects',
  codex: '~/.codex/sessions',
};

/**
 * First run, in three steps: how to open the panel, which agents were found
 * on this machine, and the few choices only the user can make (plan limits,
 * notifications, startup, updates). Everything here can be changed later in
 * Settings, which the last step says, so nothing feels final.
 */
export function Welcome() {
  const [step, setStep] = useState(0);
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const setProviderConnected = useSettings((s) => s.setProviderConnected);
  const snapshots = useApp((s) => s.snapshots);
  const refresh = useApp((s) => s.refresh);
  const setRoute = useApp((s) => s.setRoute);
  const [notify, setNotify] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const finish = () => {
    set('onboarded', true);
    setRoute('dashboard');
  };

  const found = PROVIDER_IDS.filter((id) => {
    const snap = snapshots.find((s) => s.provider.id === id);
    return snap && snap.provider.status !== 'offline';
  });

  const steps: Array<{ title: string; body: ReactNode }> = [
    {
      title: 'Welcome to AI Control Center',
      body: (
        <div className="space-y-4">
          <p className="t-body max-w-[52ch] text-text-2">
            One glance at every AI coding agent on this machine: how much usage is left, what
            each agent is doing right now, and what it did recently.
          </p>
          <Row icon={<MousePointer2 size={16} strokeWidth={1.9} />} title="Open it from the screen edge">
            Push the cursor into the {settings.edge} edge of your screen, or press{' '}
            <kbd className="t-mono rounded-sm border border-rule-strong px-1.5 py-0.5 text-text-1">
              {formatAccelerator(settings.shortcut)}
            </kbd>
            . Click anywhere else or press Esc to put it away.
          </Row>
          <Row icon={<ShieldCheck size={16} strokeWidth={1.9} />} title="Stays on this machine">
            It reads the session files Claude Code and Codex already keep on your computer. No
            sign-in, no API keys, and your activity is never sent anywhere.
          </Row>
        </div>
      ),
    },
    {
      title: found.length > 0 ? 'Your agents' : 'No agents found yet',
      body: (
        <div className="space-y-3">
          <p className="t-body max-w-[52ch] text-text-2">
            {found.length > 0
              ? 'These were found on this computer. Turn off any you do not want shown.'
              : 'Install Claude Code or Codex and run it once. It appears here by itself, with nothing to set up.'}
          </p>
          <div className="space-y-2">
            {PROVIDER_IDS.map((id) => {
              const cat = CATEGORIES[id];
              const isFound = found.includes(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-lg border border-row-border bg-row px-3.5 py-3"
                >
                  <cat.icon size={16} strokeWidth={2} className={cat.text} />
                  <div className="min-w-0 flex-1">
                    <p className="t-strong text-text-1">{cat.label}</p>
                    <p className="t-caption mt-0.5 flex items-center gap-1.5 text-text-2">
                      {isFound ? (
                        <Check size={12} strokeWidth={2.4} className="text-ok" />
                      ) : (
                        <CircleDashed size={12} strokeWidth={2} />
                      )}
                      {isFound ? 'Found in ' : 'Not found in '}
                      <span className="t-mono">{WHERE[id]}</span>
                    </p>
                  </div>
                  <Toggle
                    id={`welcome-${id}`}
                    label={`Show ${cat.label}`}
                    checked={settings.connected[id] ?? false}
                    onChange={(next) => {
                      setProviderConnected(id, next);
                      void refresh();
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      title: 'A few choices',
      body: (
        <div className="grid gap-3 @min-[640px]:grid-cols-2">
          <div className="rounded-lg bg-card py-1.5">
            <p className="t-caption px-4 pt-2 text-text-2">
              Providers don't share plan limits with other apps, so "% left" is measured against
              the limit you set. Not sure? Leave it, and set it from your usage the next time you
              hit your limit.
            </p>
            {PROVIDER_IDS.map((id) => (
              <LimitEditor key={id} id={id} />
            ))}
          </div>
          <div className="space-y-2 rounded-lg bg-card px-4 py-3">
            <ChoiceRow label="Launch at startup" hint="So it is there whenever you need it">
              <Toggle
                id="welcome-startup"
                label="Launch at startup"
                checked={settings.launchAtStartup}
                onChange={(next) => {
                  set('launchAtStartup', next);
                  void invokeSafe<void>('set_autostart', { enabled: next }, undefined);
                }}
              />
            </ChoiceRow>
            <ChoiceRow label="Check for updates" hint="Asks GitHub for a newer version, nothing else">
              <Toggle
                id="welcome-updates"
                label="Check for updates"
                checked={settings.checkForUpdates}
                onChange={(next) => set('checkForUpdates', next)}
              />
            </ChoiceRow>
            {isTauri() && (
              <ChoiceRow
                label="Notifications"
                hint="When an agent finishes, needs you, or usage runs low"
              >
                <button
                  type="button"
                  disabled={notify !== 'unknown'}
                  onClick={async () => {
                    const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
                    setNotify(granted ? 'granted' : 'denied');
                  }}
                  className="t-label flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-rule-strong px-3 text-text-1 transition-colors duration-100 enabled:hover:bg-card-hover disabled:opacity-70"
                >
                  {notify === 'granted' ? (
                    <Check size={13} strokeWidth={2.4} className="text-ok" />
                  ) : (
                    <Bell size={13} strokeWidth={1.9} />
                  )}
                  {notify === 'granted' ? 'Allowed' : notify === 'denied' ? 'Blocked' : 'Allow'}
                </button>
              </ChoiceRow>
            )}
            <p className="t-caption pt-1 text-text-3">All of this can be changed later in Settings.</p>
          </div>
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const current = steps[step];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 pt-5">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="t-title mb-3 text-[1.375rem] leading-7 text-text-1">{current.title}</h1>
            {current.body}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="mt-4 flex items-center gap-3">
        <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                i === step ? 'w-5 bg-text-1' : 'w-1.5 bg-rule-strong',
              )}
            />
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="t-label h-9 rounded-full border border-rule-strong px-4 text-text-1 transition-colors duration-100 hover:bg-card-hover"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="t-label h-9 rounded-full bg-primary px-5 text-primary-fg transition-[background-color,transform] duration-100 hover:bg-primary-hover active:scale-[0.97]"
          >
            {last ? 'Start using it' : 'Continue'}
          </button>
        </div>
      </footer>
    </div>
  );
}

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-card p-4">
      <span className="mt-0.5 text-text-2">{icon}</span>
      <div>
        <p className="t-strong text-text-1">{title}</p>
        <p className="t-body mt-1 max-w-[56ch] text-text-2">{children}</p>
      </div>
    </div>
  );
}

function ChoiceRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="t-body text-text-1">{label}</p>
        <p className="t-caption mt-0.5 text-text-2">{hint}</p>
      </div>
      {children}
    </div>
  );
}
