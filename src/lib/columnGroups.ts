export const COLUMN_GROUPS = ["BACKLOG", "UNSTARTED", "STARTED", "COMPLETED", "CANCELLED"] as const;

export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export const DEFAULT_COLUMN_GROUP: ColumnGroup = "UNSTARTED";

export const DEFAULT_PROJECT_COLUMNS: ReadonlyArray<{ name: string; order: number; group: ColumnGroup; isDone: boolean }> = [
  { name: "Backlog", order: 0, group: "BACKLOG", isDone: false },
  { name: "To Do", order: 1, group: "UNSTARTED", isDone: false },
  { name: "In Progress", order: 2, group: "STARTED", isDone: false },
  { name: "Done", order: 3, group: "COMPLETED", isDone: true },
];

export const GROUP_CONFLICTS_WITH_IS_DONE_ERROR = "isDone must be true exactly when group is COMPLETED";

export function isClosedGroup(group: string | null | undefined): boolean {
  return group === "COMPLETED" || group === "CANCELLED";
}

export function isClosedColumn(column: { group?: string | null; isDone?: boolean | null }): boolean {
  return !!column.isDone || isClosedGroup(column.group);
}

export function parseColumnGroupFilter(
  value: unknown
): { success: true; groups: ColumnGroup[] } | { success: false; error: string } {
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const groups = raw.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  const invalid = groups.filter((group) => !(COLUMN_GROUPS as readonly string[]).includes(group));
  if (groups.length === 0 || invalid.length > 0) {
    return {
      success: false,
      error: `Invalid columnGroup ${invalid.length ? `'${invalid.join(",")}'` : "(empty)"}. Expected one or more of ${COLUMN_GROUPS.join(", ")}.`,
    };
  }
  return { success: true, groups: groups as ColumnGroup[] };
}

export type ResolvedColumnGroup =
  | { success: true; group: ColumnGroup; isDone: boolean }
  | { success: false; error: string };

export function resolveColumnGroup(
  input: { group?: ColumnGroup; isDone?: boolean },
  existingGroup?: string
): ResolvedColumnGroup {
  const { group, isDone } = input;

  if (group !== undefined) {
    if (isDone !== undefined && isDone !== (group === "COMPLETED")) {
      return { success: false, error: GROUP_CONFLICTS_WITH_IS_DONE_ERROR };
    }
    return { success: true, group, isDone: group === "COMPLETED" };
  }

  const current = (COLUMN_GROUPS as readonly string[]).includes(existingGroup ?? "")
    ? (existingGroup as ColumnGroup)
    : DEFAULT_COLUMN_GROUP;

  if (isDone === true) return { success: true, group: "COMPLETED", isDone: true };
  if (isDone === false && current === "COMPLETED") {
    return { success: true, group: DEFAULT_COLUMN_GROUP, isDone: false };
  }
  return { success: true, group: current, isDone: current === "COMPLETED" };
}
