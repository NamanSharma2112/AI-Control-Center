import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { AppNotification, NotificationSeverity } from '@/types/domain';
import { NOTIFICATION_VARIANTS } from '@/lib/motion';
import { IconButton } from '@/components/ui/IconButton';
import { StatusDot, type Tone } from '@/components/ui/StatusDot';
import { cn } from '@/lib/cn';
import type { MotionIntensity } from '@/store/settings';

const SEVERITY_TONE: Record<NotificationSeverity, Tone> = {
  info: 'accent',
  warn: 'warn',
  error: 'error',
};

/**
 * Notifications live at the top of the panel, inside it, rather than as OS
 * toasts that would interrupt. At most four, newest first, each dismissible.
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
  if (notifications.length === 0) return null;

  return (
    <div className="border-b border-rule">
      <AnimatePresence initial={false}>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            layout={intensity === 'full'}
            variants={NOTIFICATION_VARIANTS}
            initial={intensity === 'full' ? 'hidden' : false}
            animate="visible"
            exit="exit"
            className={cn(
              'flex items-start gap-2 px-3.5 py-2',
              n.severity === 'error' && 'bg-error-well/35',
              n.severity === 'warn' && 'bg-warn-well/30',
            )}
          >
            <StatusDot tone={SEVERITY_TONE[n.severity]} className="mt-[5px]" />
            <div className="min-w-0 flex-1">
              <p className="t-body text-text-1">{n.title}</p>
              {n.detail && <p className="t-meta mt-0.5 truncate text-text-2">{n.detail}</p>}
            </div>
            <IconButton icon={X} label="Dismiss" onClick={() => onDismiss(n.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
