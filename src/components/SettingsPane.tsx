import { useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { useSettings } from '@/store/settings';
import type { EdgeSide, MotionIntensity, RetentionDays, ThemeMode } from '@/store/settings';
import { useApp } from '@/store/app';
import { PROVIDER_IDS, PROVIDER_NAMES } from '@/providers/registry';
import { SectionHeader, Rule } from '@/components/ui/SectionHeader';
import { Field, Segmented, Slider, Toggle } from '@/components/ui/Field';
import { ShortcutRecorder } from './ShortcutRecorder';
import { StatusDot, PROVIDER_TONE, PROVIDER_WORD } from '@/components/ui/StatusDot';
import { invokeSafe, isTauri } from '@/lib/tauri';
import { cn } from '@/lib/cn';

/**
 * Settings. Every control here maps to a decision the user genuinely owns;
 * nothing was added to paper over an undecided default.
 */
export function SettingsPane() {
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const setProviderConnected = useSettings((s) => s.setProviderConnected);
  const snapshots = useApp((s) => s.snapshots);
  const refresh = useApp((s) => s.refresh);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const [cleared, setCleared] = useState(false);

  return (
    <div className="flex flex-col pb-2">
      <section aria-labelledby="set-general">
        <SectionHeader className="pt-3">
          <span id="set-general">General</span>
        </SectionHeader>

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

        <Field label="Panel edge" hint="Which side the panel is attached to">
          <Segmented<EdgeSide>
            label="Panel edge"
            value={settings.edge}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(next) => {
              set('edge', next);
              void invokeSafe<void>('apply_window_layout', { edge: next, width: settings.panelWidth }, undefined);
            }}
          />
        </Field>

        <Field label="Edge activation" hint="Open when the cursor reaches the edge" htmlFor="edge-on">
          <Toggle
            id="edge-on"
            label="Edge activation"
            checked={settings.edgeActivationEnabled}
            onChange={(next) => {
              set('edgeActivationEnabled', next);
              void invokeSafe<void>('set_edge_watch', { enabled: next }, undefined);
            }}
          />
        </Field>

        <Field label="Activation zone" hint="Distance from the edge that arms it" htmlFor="sens">
          <Slider
            id="sens"
            label="Activation zone"
            value={settings.edgeSensitivity}
            min={1}
            max={12}
            unit="px"
            onChange={(next) => {
              set('edgeSensitivity', next);
              void invokeSafe<void>('set_edge_config', { sensitivity: next, dwellMs: settings.edgeDwellMs }, undefined);
            }}
          />
        </Field>

        <Field label="Activation delay" hint="Dwell before opening, to avoid accidents" htmlFor="dwell">
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
              void invokeSafe<void>('set_edge_config', { sensitivity: settings.edgeSensitivity, dwellMs: next }, undefined);
            }}
          />
        </Field>

        <Field label="Panel width" htmlFor="width">
          <Slider
            id="width"
            label="Panel width"
            value={settings.panelWidth}
            min={340}
            max={460}
            step={10}
            unit="px"
            onChange={(next) => {
              set('panelWidth', next);
              void invokeSafe<void>('apply_window_layout', { edge: settings.edge, width: next }, undefined);
            }}
          />
        </Field>

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

        <Field label="Motion" hint="System reduced-motion is always honored">
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

        <Field label="Toggle shortcut" hint="Works anywhere on the desktop" stacked>
          <ShortcutRecorder
            value={settings.shortcut}
            onChange={(next) => {
              set('shortcut', next);
              void invokeSafe<void>('set_shortcut', { accelerator: next }, undefined);
            }}
          />
        </Field>
      </section>

      <Rule />

      <section aria-labelledby="set-providers">
        <SectionHeader>
          <span id="set-providers">Providers</span>
        </SectionHeader>

        {PROVIDER_IDS.map((id) => {
          const snapshot = snapshots.find((s) => s.provider.id === id);
          const status = snapshot?.provider.status ?? 'offline';
          return (
            <Field
              key={id}
              label={PROVIDER_NAMES[id]}
              hint={
                snapshot?.provider.statusDetail ??
                (settings.connected[id]
                  ? `${PROVIDER_WORD[status]} · reads local session state`
                  : 'Not connected')
              }
              htmlFor={`conn-${id}`}
            >
              <div className="flex items-center gap-2">
                <StatusDot tone={PROVIDER_TONE[status]} />
                <Toggle
                  id={`conn-${id}`}
                  label={`Connect ${PROVIDER_NAMES[id]}`}
                  checked={settings.connected[id] ?? false}
                  onChange={(next) => {
                    setProviderConnected(id, next);
                    void refresh();
                  }}
                />
              </div>
            </Field>
          );
        })}

        <Field
          label="Data source"
          hint={
            mode === 'live'
              ? 'Reading local CLI state on this machine'
              : 'Sample data, for layout review'
          }
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
      </section>

      <Rule />

      <section aria-labelledby="set-notifications">
        <SectionHeader>
          <span id="set-notifications">Notifications</span>
        </SectionHeader>

        <Field label="Usage threshold" hint="Notify when remaining usage drops below" htmlFor="thresh">
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

        <Field label="Usage warnings" htmlFor="n-usage">
          <Toggle
            id="n-usage"
            label="Usage warnings"
            checked={settings.notifyOnUsage}
            onChange={(next) => set('notifyOnUsage', next)}
          />
        </Field>

        <Field label="Session completed" htmlFor="n-session">
          <Toggle
            id="n-session"
            label="Session completed"
            checked={settings.notifyOnSessionComplete}
            onChange={(next) => set('notifyOnSessionComplete', next)}
          />
        </Field>

        <Field label="Provider errors" htmlFor="n-error">
          <Toggle
            id="n-error"
            label="Provider errors"
            checked={settings.notifyOnError}
            onChange={(next) => set('notifyOnError', next)}
          />
        </Field>

        <Field label="Idle agents" hint={`After ${settings.idleAfterMinutes} minutes of silence`} htmlFor="n-idle">
          <Toggle
            id="n-idle"
            label="Idle agents"
            checked={settings.notifyOnIdle}
            onChange={(next) => set('notifyOnIdle', next)}
          />
        </Field>
      </section>

      <Rule />

      <section aria-labelledby="set-privacy">
        <SectionHeader>
          <span id="set-privacy">Privacy</span>
        </SectionHeader>

        <div className="mx-3.5 mt-1 mb-2 flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2">
          <ShieldCheck size={13} strokeWidth={1.5} className="mt-px shrink-0 text-ok" />
          <p className="t-meta text-text-2">
            Everything stays on this machine. No activity is sent anywhere, and
            credentials are held by the OS keychain, never by the database.
          </p>
        </div>

        <Field label="Local-only mode" hint="Blocks all outbound requests" htmlFor="local-only">
          <Toggle
            id="local-only"
            label="Local-only mode"
            checked={settings.localOnlyMode}
            onChange={(next) => set('localOnlyMode', next)}
          />
        </Field>

        <Field label="Keep activity for">
          <Segmented<string>
            label="Activity retention"
            value={String(settings.retentionDays)}
            options={[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
              { value: '0', label: 'Forever' },
            ]}
            onChange={(next) => {
              const days = Number(next) as RetentionDays;
              set('retentionDays', days);
              void invokeSafe<void>('set_retention', { days }, undefined);
            }}
          />
        </Field>

        <Field label="Clear local data" hint="Removes stored activity, sessions, and history">
          <button
            type="button"
            onClick={() => {
              if (!cleared) {
                setCleared(true);
                return;
              }
              setCleared(false);
              void invokeSafe<void>('clear_local_data', undefined, undefined).then(() => refresh());
            }}
            onBlur={() => setCleared(false)}
            className={cn(
              't-label inline-flex items-center gap-1.5 rounded-md px-2 py-1',
              'transition-colors duration-[90ms]',
              cleared
                ? 'bg-error-well text-error'
                : 'bg-surface-2 text-text-2 hover:text-text-1',
            )}
          >
            <Trash2 size={12} strokeWidth={1.5} />
            {cleared ? 'Click again to clear' : 'Clear'}
          </button>
        </Field>
      </section>

      {!isTauri() && (
        <p className="t-meta mx-3.5 mt-2 rounded-md bg-surface-2 px-2.5 py-2 text-text-3">
          Running in a browser preview. Startup, shortcuts, edge activation, and
          local provider reads need the desktop app.
        </p>
      )}
    </div>
  );
}
