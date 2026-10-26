import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, Info, X } from 'lucide-react';
import type { AppNotification, NotificationSeverity } from '@/types/domain';
import { NOTIFICATION_VARIANTS } from '@/lib/motion';
import { cn } from '@/lib/cn';
import type { MotionIntensity } from '@/store/settings';

const TONE: Record<NotificationSeverity, string> = {
  info: 'text-text-2',
  warn: 'text-warn',
  error: 'text-error',
};

/**
 * Notices sit inside the panel, under the title, rather than as OS toasts
 * that would interrupt. At most four, newest first, each dismissible.
 */
export function NotificationStack({
  notifications,
  onDismiss,
  intensity,
}: {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  intensity: MotionIntensity;
}) {
  return (
    <AnimatePresence initial={false}>
      {notifications.length > 0 && (
        <motion.ul
          key="stack"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: intensity === 'full' ? 0.22 : 0 }}
          className="mt-3 space-y-1.5 overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {notifications.map((n) => {
              const Icon = n.severity === 'info' ? Info : CircleAlert;
              return (
                <motion.li
                  key={n.id}
                  layout={intensity === 'full'}
                  variants={NOTIFICATION_VARIANTS}
                  initial={intensity === 'full' ? 'hidden' : false}
                  animate="visible"
                  exit="exit"
                  className="flex items-start gap-2.5 rounded-md border border-row-border bg-row px-3 py-2"
                >
                  <Icon size={15} strokeWidth={1.9} className={cn('mt-0.5 shrink-0', TONE[n.severity])} />
                  <div className="min-w-0 flex-1">
                    <p className="t-body text-text-1">{n.title}</p>
                    {n.detail && <p className="t-caption mt-0.5 truncate text-text-2">{n.detail}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => onDismiss(n.id)}
                    className="grid size-6 shrink-0 place-items-center rounded-full text-text-3 transition-colors duration-100 hover:bg-card hover:text-text-1"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </AnimatePresence>
  );
}
