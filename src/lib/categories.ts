import { Asterisk, Bot, Braces, type LucideIcon } from 'lucide-react';
import type { ProviderId } from '@/types/domain';

/**
 * Category identity. One color per thing, used everywhere that thing appears:
 * its metric card, its chart, its stacked-bar segment, its legend dot and its
 * agents. That consistency is what lets the eye join the left column to the
 * right without reading a label.
 *
 * Icons are generic glyphs, deliberately not provider logos.
 */
export type CategoryId = ProviderId | 'agents';

export interface Category {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes, spelled out so the compiler can see them. */
  text: string;
  bg: string;
  /** Raw CSS color, for SVG fills and strokes. */
  color: string;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    icon: Asterisk,
    text: 'text-claude',
    bg: 'bg-claude',
    color: 'var(--cat-claude)',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    icon: Braces,
    text: 'text-codex',
    bg: 'bg-codex',
    color: 'var(--cat-codex)',
  },
  agents: {
    id: 'agents',
    label: 'Agent sessions',
    icon: Bot,
    text: 'text-agents',
    bg: 'bg-agents',
    color: 'var(--cat-agents)',
  },
};
