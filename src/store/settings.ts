import { create } from 'zustand';
import type { ProviderId } from '@/types/domain';
import { invokeSafe, isTauri } from '@/lib/tauri';

export type EdgeSide = 'left' | 'right';
export type ThemeMode = 'system' | 'dark' | 'light';
export type MotionIntensity = 'full' | 'reduced' | 'none';
export type RetentionDays = 7 | 30 | 90 | 0;

/**
 * Preferences. Intentionally small: every setting here exists because the
 * brief named a real decision the user owns. No setting is added to
 * compensate for a design we did not commit to.
 */
export interface Settings {
  // General
  launchAtStartup: boolean;
  edge: EdgeSide;
  /** Pixels from the edge that arm activation. 1–12. */
  edgeSensitivity: number;
  /** ms the cursor must dwell in the hot zone before the panel opens. */
  edgeDwellMs: number;
  panelWidth: number;
  motionIntensity: MotionIntensity;
  shortcut: string;
  theme: ThemeMode;
  edgeActivationEnabled: boolean;

  // Providers
  connected: Record<ProviderId, boolean>;
  /** Locally-set ceilings used to express usage as a percentage. */
  caps: Record<ProviderId, number>;

  // Notifications
  notifyUsageThreshold: number;
  notifyOnUsage: boolean;
  notifyOnSessionComplete: boolean;
  notifyOnError: boolean;
  notifyOnIdle: boolean;
  /** Minutes of silence before an idle agent is worth mentioning. */
  idleAfterMinutes: number;

  // Privacy
  localOnlyMode: boolean;
  retentionDays: RetentionDays;
}

export const DEFAULT_SETTINGS: Settings = {
  launchAtStartup: false,
  edge: 'right',
  edgeSensitivity: 3,
  edgeDwellMs: 120,
  panelWidth: 880,
  motionIntensity: 'full',
  shortcut: 'CommandOrControl+Shift+Space',
  theme: 'system',
  edgeActivationEnabled: true,

  connected: { codex: true, 'claude-code': true },
  caps: { codex: 1500, 'claude-code': 2_000_000 },

  notifyUsageThreshold: 25,
  notifyOnUsage: true,
  notifyOnSessionComplete: true,
  notifyOnError: true,
  notifyOnIdle: false,
  idleAfterMinutes: 10,

  localOnlyMode: true,
  retentionDays: 30,
};

const WEB_STORAGE_KEY = 'acc.settings';

/** The console layout's width range. Narrower and the two columns collide. */
export const PANEL_WIDTH = { min: 760, max: 1040, default: 880 } as const;

/**
 * Settings saved by an older build may hold a width from the narrow strip
 * layout; bring anything out of range back to a value the layout can use.
 */
function migrate(settings: Settings): Settings {
  const { panelWidth } = settings;
  if (panelWidth < PANEL_WIDTH.min || panelWidth > PANEL_WIDTH.max) {
    return { ...settings, panelWidth: PANEL_WIDTH.default };
  }
  return settings;
}

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setProviderConnected: (id: ProviderId, connected: boolean) => void;
  reset: () => void;
}

/** Persist to SQLite through Rust in the app; to localStorage in a browser. */
async function persist(settings: Settings): Promise<void> {
  if (isTauri()) {
    await invokeSafe<void>('save_settings', { settings }, undefined);
    return;
  }
  try {
    localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: preferences stay in memory this session.
  }
}

async function restore(): Promise<Settings> {
  if (isTauri()) {
    const stored = await invokeSafe<Partial<Settings> | null>('load_settings', undefined, null);
    return stored ? migrate({ ...DEFAULT_SETTINGS, ...stored }) : DEFAULT_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(WEB_STORAGE_KEY);
    return raw
      ? migrate({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) })
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    const settings = await restore();
    set({ settings, loaded: true });
  },

  set(key, value) {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    void persist(settings);
  },

  setProviderConnected(id, connected) {
    const current = get().settings;
    const settings: Settings = {
      ...current,
      connected: { ...current.connected, [id]: connected },
    };
    set({ settings });
    void persist(settings);
  },

  reset() {
    set({ settings: DEFAULT_SETTINGS });
    void persist(DEFAULT_SETTINGS);
  },
}));

/** Selector helper so components subscribe to one field, not the whole object. */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettings((s) => s.settings[key]);
}
