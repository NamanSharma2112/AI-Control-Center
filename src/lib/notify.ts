import { toast } from 'sonner';
import type { AppNotification } from '@/types/domain';
import { invokeSafe, isTauri } from '@/lib/tauri';

let silent = false;

/**
 * Stops this window from announcing anything. The island runs its own copy of
 * the store; without this, every notice would arrive twice.
 */
export function silenceNotifications(): void {
  silent = true;
}

/**
 * Where a notice goes depends on whether the panel is open.
 *
 * Open: a toast inside the panel (sonner), because the user is looking at it
 * and a system banner on top would be noise. Hidden: a native Windows or macOS
 * notification, because a toast in a hidden window reaches no one. The Rust
 * side also refuses to show a banner while the panel is visible, so the two
 * never double up.
 */
export function deliver(n: AppNotification, panelVisible: boolean): void {
  if (silent) return;
  if (panelVisible) {
    showToast(n);
    return;
  }
  if (!isTauri()) {
    // A browser preview has no OS notifications; the toast is the best stand-in.
    showToast(n);
    return;
  }
  void invokeSafe<void>('notify', { title: n.title, body: n.detail ?? '' }, undefined);
}

export function showToast(n: Pick<AppNotification, 'title' | 'detail' | 'severity'>): void {
  const options = n.detail ? { description: n.detail } : undefined;
  if (n.severity === 'error') toast.error(n.title, options);
  else if (n.severity === 'warn') toast.warning(n.title, options);
  else toast(n.title, options);
}
