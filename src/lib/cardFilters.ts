import { db } from "@/lib/db";
import { cardTextSearch } from "@/lib/cardSearch";
import { parseColumnGroupFilter } from "@/lib/columnGroups";

export const CARD_SORT_FIELDS = ["order", "createdAt", "updatedAt", "dueDate", "priority"] as const;
export type CardSortField = (typeof CARD_SORT_FIELDS)[number];

export const PRIORITY_RANK: Record<string, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};

export function startOfUtcToday(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface CardFilterInput {
  projectId?: string | null;
  columnId?: string | null;
  priority?: string | null;
  owner?: string | null;
  assignedTo?: string | null;
  query?: string | null;
  parentId?: string | null;
  hasParent?: boolean | null;
  typeId?: string | null;
  columnGroup?: unknown;
  stateGroup?: unknown;
  labelIds?: string[] | string | null;
  dueBefore?: string | Date | null;
  dueAfter?: string | Date | null;
  isOverdue?: boolean | null;
  isArchived?: boolean | null;
}

export type BuildCardWhereResult =
  | { success: true; where: any }
  | { success: false; error: string };

export function buildCardWhere(
  input: CardFilterInput,
  accessibleScope?: object
): BuildCardWhereResult {
  const conditions: any[] = [];

  if (accessibleScope) {
    conditions.push(accessibleScope);
  }

  conditions.push({
    isArchived: typeof input.isArchived === "boolean" ? input.isArchived : false,
  });

  if (input.projectId) {
    conditions.push({ projectId: input.projectId });
  }

  if (input.columnId) {
    conditions.push({ columnId: input.columnId });
  }

  if (input.priority) {
    conditions.push({ priority: input.priority });
  }

  if (input.owner) {
    conditions.push({ owner: { contains: input.owner } });
  }

  if (input.assignedTo) {
    conditions.push({ assignees: { some: { userId: input.assignedTo } } });
  }

  if (input.query) {
    conditions.push({ OR: cardTextSearch(String(input.query)) });
  }

  if (input.parentId !== undefined) {
    const pid = input.parentId === "null" || input.parentId === "" || input.parentId === null ? null : input.parentId;
    conditions.push({ parentId: pid });
  }
  if (typeof input.hasParent === "boolean") {
    if (input.hasParent) {
      conditions.push({ parentId: { not: null } });
    } else {
      conditions.push({ parentId: null });
    }
  }

  if (input.typeId) {
    conditions.push({ typeId: input.typeId });
  }

  if (input.columnGroup !== undefined && input.columnGroup !== null) {
    const groupFilter = parseColumnGroupFilter(input.columnGroup);
    if (!groupFilter.success) {
      return { success: false, error: groupFilter.error };
    }
    conditions.push({ column: { group: { in: groupFilter.groups } } });
  }

  if (input.stateGroup !== undefined && input.stateGroup !== null) {
    const groupFilter = parseColumnGroupFilter(input.stateGroup);
    if (!groupFilter.success) {
      return { success: false, error: groupFilter.error };
    }
    conditions.push({ column: { group: { in: groupFilter.groups } } });
  }

  // Label filtering
  let labelIds: string[] = [];
  if (Array.isArray(input.labelIds)) {
    labelIds = input.labelIds
      .flatMap((id) => String(id).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (typeof input.labelIds === "string") {
    labelIds = input.labelIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (labelIds.length > 0) {
    conditions.push({ labels: { some: { labelId: { in: labelIds } } } });
  }

  // Due date & overdue filtering
  const dueDateCondition: any = {};
  if (input.dueBefore) {
    let d: Date;
    if (typeof input.dueBefore === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueBefore.trim())) {
      d = new Date(`${input.dueBefore.trim()}T23:59:59.999Z`);
    } else {
      d = new Date(input.dueBefore);
    }
    if (isNaN(d.getTime())) {
      return { success: false, error: "Invalid dueBefore date" };
    }
    dueDateCondition.lte = d;
  }

  if (input.dueAfter) {
    let d: Date;
    if (typeof input.dueAfter === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueAfter.trim())) {
      d = new Date(`${input.dueAfter.trim()}T00:00:00.000Z`);
    } else {
      d = new Date(input.dueAfter);
    }
    if (isNaN(d.getTime())) {
      return { success: false, error: "Invalid dueAfter date" };
    }
    dueDateCondition.gte = d;
  }

  if (input.isOverdue === true) {
    const today = startOfUtcToday();
    dueDateCondition.lt = today;
    conditions.push({
      completedAt: null,
      column: { isDone: false, group: { not: "CANCELLED" } },
    });
  } else if (input.isOverdue === false) {
    const today = startOfUtcToday();
    conditions.push({
      OR: [
        { dueDate: null },
        { dueDate: { gte: today } },
        { completedAt: { not: null } },
        { column: { isDone: true } },
        { column: { group: "CANCELLED" } },
      ],
    });
  }

  if (Object.keys(dueDateCondition).length > 0) {
    conditions.push({ dueDate: dueDateCondition });
  }

  const where = conditions.length === 1 ? conditions[0] : { AND: conditions };
  return { success: true, where };
}

export type ParseCardOrderByResult =
  | { success: true; sort: { field: CardSortField; direction: "asc" | "desc" } }
  | { success: false; error: string };

export function parseCardOrderBy(
  orderBy?: string | null,
  orderDirection?: string | null
): ParseCardOrderByResult {
  if (!orderBy) {
    if (orderDirection && orderDirection !== "asc" && orderDirection !== "desc") {
      return { success: false, error: `Invalid orderDirection '${orderDirection}'. Expected asc or desc.` };
    }
    return { success: true, sort: { field: "order", direction: (orderDirection as "asc" | "desc") || "asc" } };
  }

  let fieldPart = orderBy.trim();
  let dirPart = orderDirection ? orderDirection.trim().toLowerCase() : undefined;

  if (fieldPart.includes(":")) {
    const [f, d] = fieldPart.split(":");
    fieldPart = f.trim();
    if (!dirPart && (d.toLowerCase() === "asc" || d.toLowerCase() === "desc")) {
      dirPart = d.toLowerCase();
    }
  }

  const fieldNorm = fieldPart.toLowerCase();
  let field: CardSortField | null = null;

  if (fieldNorm === "created" || fieldNorm === "createdat") {
    field = "createdAt";
  } else if (fieldNorm === "updated" || fieldNorm === "updatedat") {
    field = "updatedAt";
  } else if (fieldNorm === "due" || fieldNorm === "duedate") {
    field = "dueDate";
  } else if (fieldNorm === "priority") {
    field = "priority";
  } else if (fieldNorm === "order") {
    field = "order";
  }

  if (!field) {
    return {
      success: false,
      error: `Invalid orderBy '${orderBy}'. Expected one of created, createdAt, updated, updatedAt, due, dueDate, priority, order.`,
    };
  }

  if (dirPart && dirPart !== "asc" && dirPart !== "desc") {
    return {
      success: false,
      error: `Invalid orderDirection '${dirPart}'. Expected asc or desc.`,
    };
  }

  const direction: "asc" | "desc" = dirPart === "desc" ? "desc" : "asc";
  return { success: true, sort: { field, direction } };
}

export type CardGroupBy = "column" | "priority" | "label";

export function validateCardGroupBy(
  groupBy?: string | null
): { success: true; groupBy?: CardGroupBy } | { success: false; error: string } {
  if (!groupBy || !groupBy.trim()) return { success: true };
  const normalized = groupBy.trim().toLowerCase();
  if (normalized === "column" || normalized === "columnid") return { success: true, groupBy: "column" };
  if (normalized === "priority") return { success: true, groupBy: "priority" };
  if (normalized === "label" || normalized === "labelid") return { success: true, groupBy: "label" };
  return { success: false, error: `Invalid groupBy '${groupBy}'. Expected one of column, priority, label.` };
}

export interface CountCardsResult {
  count: number;
  groups?: Array<{ columnId?: string; priority?: string; labelId?: string; count: number }>;
}

export async function countCards(
  where: object,
  groupBy?: CardGroupBy | null
): Promise<CountCardsResult> {
  const total = await db.card.count({ where });

  if (!groupBy) {
    return { count: total };
  }

  if (groupBy === "column") {
    const rows = await db.card.groupBy({
      by: ["columnId"],
      where,
      _count: { _all: true },
    });
    return {
      count: total,
      groups: rows.map((r) => ({ columnId: r.columnId, count: r._count._all })),
    };
  }

  if (groupBy === "priority") {
    const rows = await db.card.groupBy({
      by: ["priority"],
      where,
      _count: { _all: true },
    });
    return {
      count: total,
      groups: rows.map((r) => ({ priority: r.priority, count: r._count._all })),
    };
  }

  if (groupBy === "label") {
    const rows = await db.cardLabel.groupBy({
      by: ["labelId"],
      where: { card: where },
      _count: { _all: true },
    });
    return {
      count: total,
      groups: rows.map((r) => ({ labelId: r.labelId, count: r._count._all })),
    };
  }

  return { count: total };
}
