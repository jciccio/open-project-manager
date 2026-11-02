"use client";

import { CheckCircle2, Circle, CircleDashed, CircleDot, CircleX } from "lucide-react";
import type { ColumnGroup } from "@/lib/columnGroups";

const GROUP_ICONS: Record<ColumnGroup, { Icon: typeof Circle; className: string }> = {
  BACKLOG: { Icon: CircleDashed, className: "text-slate-400" },
  UNSTARTED: { Icon: Circle, className: "text-slate-500 dark:text-slate-400" },
  STARTED: { Icon: CircleDot, className: "text-amber-500" },
  COMPLETED: { Icon: CheckCircle2, className: "text-emerald-500" },
  CANCELLED: { Icon: CircleX, className: "text-rose-500" },
};

interface Props {
  group?: string | null;
  isDone?: boolean;
  color?: string | null;
  label: string;
}

export default function ColumnGroupIcon({ group, isDone, color, label }: Props) {
  const key = (group && group in GROUP_ICONS ? group : isDone ? "COMPLETED" : "UNSTARTED") as ColumnGroup;
  const { Icon, className } = GROUP_ICONS[key];
  return (
    <span title={label} aria-label={label} role="img" data-group={key}>
      <Icon className={`h-4 w-4 shrink-0 ${color ? "" : className}`} style={color ? { color } : undefined} />
    </span>
  );
}
