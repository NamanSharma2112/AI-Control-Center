import { useState, type ReactNode } from 'react';
import { ArrowLeft, ShieldCheck, Trash2 } from 'lucide-react';
import { useSettings, PANEL_WIDTH } from '@/store/settings';
import type { EdgeSide, MotionIntensity, RetentionDays, ThemeMode } from '@/store/settings';
import { useApp } from '@/store/app';
import { PROVIDER_IDS } from '@/providers/registry';
import { CATEGORIES } from '@/lib/categories';
import { Field, Segmented, Slider, Toggle } from '@/components/ui/Field';
import { ShortcutRecorder } from './ShortcutRecorder';
import { LimitEditor } from './LimitEditor';
import { useUpdates } from '@/store/updates';
import { invokeSafe, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/cn';

/**
 * Settings, as the panel's second face. Every control maps to a decision the
 * user genuinely owns; nothing here papers over an undecided default.
 */
export function SettingsPane() {
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const setProviderConnected = useSettings((s) => s.setProviderConnected);
  const snapshots = useApp((s) => s.snapshots);
  const refresh = useApp((s) => s.refresh);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const setRoute = useApp((s) => s.setRoute);
  const [confirmClear, setConfirmClear] = useState(false);

  const applyLayout = (edge: EdgeSide, width: number) =>
    void invokeSafe<void>('apply_window_layout', { edge, width }, undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRoute('dashboard')}
          aria-label="Back to overview"
          className="-ml-1.5 grid size-8 place-items-center rounded-full text-text-2 transition-colors duration-100 hover:bg-card hover:text-text-1"
        >
          <ArrowLeft size={16} strokeWidth={1.9} />
        </button>
        <h1 className="t-title text-text-1">Settings</h1>
        {!isTauri() && (
          <span className="t-caption ml-auto text-text-3">
            Browser preview: OS features need the desktop app
          </span>
        )}
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-3 @min-[640px]:grid-cols-2">
          <div className="space-y-3">
            <Group title="Panel">
              <Field label="Screen edge" hint="Where the panel appears">
                <Segmented<EdgeSide>
                  label="Screen edge"
                  value={settings.edge}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(next) => {
                    set('edge', next);
                    applyLayout(next, settings.panelWidth);
                  }}
                />
              </Field>
              <Field label="Open at the edge" hint="Push the cursor into the edge" htmlFor="edge-on">
                <Toggle
                  id="edge-on"
                  label="Open at the edge"
                  checked={settings.edgeActivationEnabled}
                  onChange={(next) => {
                    set('edgeActivationEnabled', next);
                    void invokeSafe<void>('set_edge_watch', { enabled: next }, undefined);
                  }}
                />
              </Field>
              <Field label="Activation zone" hint="Distance from the edge" htmlFor="sens">
                <Slider
                  id="sens"
                  label="Activation zone"
                  value={settings.edgeSensitivity}
                  min={1}
                  max={12}
                  unit="px"
                  onChange={(next) => {
                    set('edgeSensitivity', next);
                    void invokeSafe<void>(
                      'set_edge_config',
                      { sensitivity: next, dwellMs: settings.edgeDwellMs },
                      undefined,
                    );
                  }}
                />
              </Field>
              <Field label="Activation delay" hint="Dwell first, to avoid accidents" htmlFor="dwell">
                <Slider
                  id="dwell"
                  label="Activation delay"
                  value={settings.edgeDwellMs}
                  min={0}
                  max={600}
                  step={20}
                  unit="ms"
                  onChange={(next) => {
                    set('edgeDwellMs', next);
                    void invokeSafe<void>(
                      'set_edge_config',
                      { sensitivity: settings.edgeSensitivity, dwellMs: next },
                      undefined,
                    );
                  }}
                />
              </Field>
              <Field label="Panel width" htmlFor="width">
                <Slider
                  id="width"
                  label="Panel width"
                  value={settings.panelWidth}
                  min={PANEL_WIDTH.min}
                  max={PANEL_WIDTH.max}
                  step={20}
                  unit="px"
                  onChange={(next) => {
                    set('panelWidth', next);
                    applyLayout(settings.edge, next);
                  }}
                />
              </Field>
              <Field label="Toggle shortcut" hint="Works anywhere on the desktop" stacked>
                <ShortcutRecorder
                  value={settings.shortcut}
                  onChange={(next) => {
                    set('shortcut', next);
                    void invokeSafe<void>('set_shortcut', { accelerator: next }, undefined);
                  }}
                />
              </Field>
            </Group>

            <Group title="Appearance">
              <Field label="Theme">
                <Segmented<ThemeMode>
                  label="Theme"
                  value={settings.theme}
                  options={[
                    { value: 'system', label: 'Auto' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                  ]}
                  onChange={(next) => set('theme', next)}
                />
              </Field>
              <Field label="Motion" hint="System reduced motion always wins">
                <Segmented<MotionIntensity>
                  label="Motion"
                  value={settings.motionIntensity}
                  options={[
                    { value: 'full', label: 'Full' },
                    { value: 'reduced', label: 'Subtle' },
                    { value: 'none', label: 'Off' },
                  ]}
                  onChange={(next) => set('motionIntensity', next)}
                />
              </Field>
              <Field label="Launch at startup" htmlFor="launch">
                <Toggle
                  id="launch"
                  label="Launch at startup"
                  checked={settings.launchAtStartup}
                  onChange={(next) => {
                    set('launchAtStartup', next);
                    void invokeSafe<void>('set_autostart', { enabled: next }, undefined);
                  }}
                />
              </Field>
            </Group>
          </div>

          <div className="space-y-3">
            <Group title="Providers">
              {PROVIDER_IDS.map((id) => {
                const cat = CATEGORIES[id];
                const snapshot = snapshots.find((s) => s.provider.id === id);
                const detail =
                  snapshot?.provider.statusDetail ??
                  (settings.connected[id] ? 'Reads local session files' : 'Not connected');
                return (
                  <div key={id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <cat.icon size={15} strokeWidth={2} className={cat.text} />
                      <div className="min-w-0">
                        <p className="t-body text-text-1">{cat.label}</p>
                        <p className="t-caption mt-0.5 truncate text-text-2">{detail}</p>
                      </div>
                    </div>
                    <Toggle
                      id={`conn-${id}`}
                      label={`Connect ${cat.label}`}
                      checked={settings.connected[id] ?? false}
                      onChange={(next) => {
                        setProviderConnected(id, next);
                        void refresh();
                      }}
                    />
                  </div>
                );
              })}
              <Field label="Welcome tour" hint="See the first-run steps again">
                <button
                  type="button"
                  onClick={() => setRoute('welcome')}
                  className="t-label flex h-8 items-center rounded-full border border-rule-strong px-3.5 whitespace-nowrap text-text-1 transition-colors duration-100 hover:bg-card-hover"
                >
                  Show
                </button>
              </Field>
            </Group>

            <Group title="Plan limits">
              <p className="t-caption px-4 pt-1 pb-1 text-text-2">
                Providers don't share plan limits with other apps, so "% left" is measured
                against the limit you set here.
              </p>
              {PROVIDER_IDS.map((id) => (
                <LimitEditor key={id} id={id} />
              ))}
            </Group>

            <Group title="Data">
              <Field
                label="Source"
                hint={mode === 'live' ? 'Live from this machine' : 'Sample data, for layout review'}
              >
                <Segmented<'live' | 'mock'>
                  label="Data source"
                  value={mode}
                  options={[
                    { value: 'live', label: 'Live' },
                    { value: 'mock', label: 'Sample' },
                  ]}
                  onChange={setMode}
                />
              </Field>
            </Group>

            <Group title="Notifications">
              <Field label="Usage below" hint="Remaining share that triggers a notice" htmlFor="thresh">
                <Slider
                  id="thresh"
                  label="Usage threshold"
                  value={settings.notifyUsageThreshold}
                  min={5}
                  max={50}
                  step={5}
                  unit="%"
                  onChange={(next) => set('notifyUsageThreshold', next)}
                />
              </Field>
              <ToggleRow id="n-usage" label="Usage warnings" checked={settings.notifyOnUsage} onChange={(v) => set('notifyOnUsage', v)} />
              <ToggleRow id="n-session" label="Agent finished" checked={settings.notifyOnSessionComplete} onChange={(v) => set('notifyOnSessionComplete', v)} />
              <ToggleRow id="n-error" label="Provider errors" checked={settings.notifyOnError} onChange={(v) => set('notifyOnError', v)} />
              <ToggleRow
                id="n-needs"
                label="Agent needs you"
                hint="Stuck on a tool call, usually waiting for approval"
                checked={settings.notifyOnNeedsYou}
                onChange={(v) => set('notifyOnNeedsYou', v)}
              />
            </Group>

            <Group title="Privacy">
              <div className="flex items-start gap-2.5 px-4 py-3">
                <ShieldCheck size={15} strokeWidth={1.9} className="mt-0.5 shrink-0 text-ok" />
                <p className="t-caption text-text-2">
                  Your activity never leaves this machine. The only network request is the
                  optional update check, and credentials live in the OS keychain.
                </p>
              </div>
              <ToggleRow
                id="updates"
                label="Check for updates"
                hint="Asks GitHub for a newer version. Sends no activity"
                checked={settings.checkForUpdates}
                onChange={(v) => set('checkForUpdates', v)}
              />
              <UpdateRow />
              <Field label="Keep activity for">
                <Segmented<string>
                  label="Activity retention"
                  value={String(settings.retentionDays)}
                  options={[
                    { value: '7', label: '7d' },
                    { value: '30', label: '30d' },
                    { value: '90', label: '90d' },
                    { value: '0', label: 'All' },
                  ]}
                  onChange={(next) => {
                    const days = Number(next) as RetentionDays;
                    set('retentionDays', days);
                    void invokeSafe<void>('set_retention', { days }, undefined);
                  }}
                />
              </Field>
              <Field label="Clear local data" hint="Activity, sessions and history">
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      return;
                    }
                    setConfirmClear(false);
                    void invokeSafe<void>('clear_local_data', undefined, undefined).then(() => refresh());
                  }}
                  onBlur={() => setConfirmClear(false)}
                  className={cn(
                    't-label flex h-8 items-center gap-1.5 rounded-full border px-3 transition-colors duration-100',
                    confirmClear
                      ? 'border-error/60 text-error'
                      : 'border-rule-strong text-text-1 hover:bg-card-hover',
                  )}
                >
                  <Trash2 size={13} strokeWidth={1.9} />
                  {confirmClear ? 'Click again to clear' : 'Clear'}
                </button>
              </Field>
            </Group>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateRow() {
  const state = useUpdates((s) => s.state);
  const check = useUpdates((s) => s.check);
  const install = useUpdates((s) => s.install);
  if (state.kind === 'unavailable') return null;

  const hint =
    state.kind === 'available'
      ? `Version ${state.version} is ready to install`
      : state.kind === 'installing'
        ? `Installing ${state.version}; the app will restart`
        : state.kind === 'current'
          ? 'You have the latest version'
          : state.kind === 'error'
            ? state.message
            : state.kind === 'checking'
              ? 'Checking…'
              : 'Not checked yet';

  return (
    <Field label="Updates" hint={hint}>
      <button
        type="button"
        disabled={state.kind === 'checking' || state.kind === 'installing'}
        onClick={() => void (state.kind === 'available' ? install() : check())}
        className={cn(
          't-label flex h-8 items-center rounded-full px-3.5 whitespace-nowrap transition-colors duration-100 disabled:opacity-50',
          state.kind === 'available'
            ? 'bg-primary text-primary-fg hover:bg-primary-hover'
            : 'border border-rule-strong text-text-1 hover:bg-card-hover',
        )}
      >
        {state.kind === 'available' ? 'Install and restart' : 'Check now'}
      </button>
    </Field>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg bg-card py-1.5">
      <h2 className="t-label px-4 pt-2 pb-1 text-text-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Toggle id={id} label={label} checked={checked} onChange={onChange} />
    </Field>
  );
}
