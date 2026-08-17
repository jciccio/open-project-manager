import { createElement } from "react";
import {
  Tag,
  CheckSquare,
  Bug,
  Sparkles,
  Flag,
  Zap,
  Star,
  AlertTriangle,
  BookOpen,
  Wrench,
  Rocket,
  Lightbulb,
  FileText,
  GitPullRequest,
  Shield,
  Layers,
  type LucideIcon,
} from "lucide-react";

export const CARD_TYPE_ICONS: Record<string, LucideIcon> = {
  Tag,
  CheckSquare,
  Bug,
  Sparkles,
  Flag,
  Zap,
  Star,
  AlertTriangle,
  BookOpen,
  Wrench,
  Rocket,
  Lightbulb,
  FileText,
  GitPullRequest,
  Shield,
  Layers,
};

export const CARD_TYPE_ICON_NAMES = Object.keys(CARD_TYPE_ICONS);

export function getCardTypeIcon(name?: string | null): LucideIcon {
  return (name && CARD_TYPE_ICONS[name]) || Tag;
}

export function CardTypeIcon({ name, className }: { name?: string | null; className?: string }) {
  return createElement(getCardTypeIcon(name), { className });
}
