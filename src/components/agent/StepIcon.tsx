import {
  FilePen,
  FileSearch,
  FlaskConical,
  GitBranch,
  Hand,
  MessageSquare,
  MessageSquareText,
  Search,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import type { StepKind } from '@/types/domain';

const ICONS: Record<StepKind, LucideIcon> = {
  prompt: MessageSquare,
  read: FileSearch,
  search: Search,
  edit: FilePen,
  test: FlaskConical,
  command: SquareTerminal,
  git: GitBranch,
  reply: MessageSquareText,
  waiting: Hand,
};

export function StepIcon({ kind, className }: { kind: StepKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon size={15} strokeWidth={1.75} className={className} aria-hidden="true" />;
}
