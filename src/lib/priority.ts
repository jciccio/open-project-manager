export const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface PriorityStyle {
  bg: string;
  text: string;
  border: string;
}

export const PRIORITY_STYLES: Record<string, PriorityStyle> = {
  NONE: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-500 dark:text-slate-400",
    border: "border-slate-300 dark:border-slate-700",
  },
  LOW: {
    bg: "bg-slate-100 dark:bg-slate-500/10",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-300 dark:border-slate-500/20",
  },
  MEDIUM: {
    bg: "bg-blue-50 dark:bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-500/20",
  },
  HIGH: {
    bg: "bg-amber-50 dark:bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-500/20",
  },
  URGENT: {
    bg: "bg-red-50 dark:bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-200 dark:border-red-500/20",
  },
};

export const PRIORITY_HEX_COLORS: Record<string, string> = {
  NONE: "#94a3b8",
  LOW: "#64748b",
  MEDIUM: "#3b82f6",
  HIGH: "#f59e0b",
  URGENT: "#ef4444",
};

export function getPriorityStyle(priority?: string | null): PriorityStyle {
  if (priority && PRIORITY_STYLES[priority]) {
    return PRIORITY_STYLES[priority];
  }
  return PRIORITY_STYLES.NONE;
}
