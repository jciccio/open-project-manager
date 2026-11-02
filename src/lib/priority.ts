export type TranslateFn = (keyPath: string, params?: Record<string, string | number>) => string;

export function priorityLabel(t: TranslateFn, priority?: string | null): string {
  switch (priority) {
    case "NONE":
      return t("cardModal.priorityNone");
    case "LOW":
      return t("cardModal.priorityLow");
    case "MEDIUM":
      return t("cardModal.priorityMedium");
    case "HIGH":
      return t("cardModal.priorityHigh");
    case "URGENT":
      return t("cardModal.priorityUrgent");
    default:
      return priority || t("cardModal.priorityNone");
  }
}

export const formatPriority = priorityLabel;
