import { create } from 'zustand';
import { invokeStrict, isTauri } from '@/lib/tauri';

type UpdateState =
  | { kind: 'unavailable' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string };

interface UpdatesStore {
  state: UpdateState;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

/**
 * Update checks. "unavailable" covers the browser preview and any build made
 * without an update signing key: the controls hide instead of failing.
 */
export const useUpdates = create<UpdatesStore>((set, get) => ({
  state: isTauri() ? { kind: 'idle' } : { kind: 'unavailable' },

  async check() {
    if (get().state.kind === 'unavailable' || get().state.kind === 'checking') return;
    set({ state: { kind: 'checking' } });
    try {
      const info = await invokeStrict<{ version: string } | null>('check_update');
      set({ state: info ? { kind: 'available', version: info.version } : { kind: 'current' } });
    } catch (cause) {
      const message = String(cause);
      set({
        state: message.includes('not available in this build')
          ? { kind: 'unavailable' }
          : { kind: 'error', message },
      });
    }
  },

  async install() {
    const current = get().state;
    if (current.kind !== 'available') return;
    set({ state: { kind: 'installing', version: current.version } });
    try {
      await invokeStrict<void>('install_update');
    } catch (cause) {
      set({ state: { kind: 'error', message: String(cause) } });
    }
  },
}));
