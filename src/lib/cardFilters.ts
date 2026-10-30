import { db } from "@/lib/db";
import { cardTextSearch } from "@/lib/cardSearch";
import { parseColumnGroupFilter } from "@/lib/columnGroups";

export const CARD_SORT_FIELDS = ["order", "createdAt", "updatedAt", "dueDate", "priority"] as const;
export type CardSortField = (typeof CARD_SORT_FIELDS)[number];

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

  if (input.parentId !== undefined && input.parentId !== null) {
    const pid = input.parentId === "null" || input.parentId === "" ? null : input.parentId;
    conditions.push({ parentId: pid });
  } else if (typeof input.hasParent === "boolean") {
    if (input.hasParent) {
      conditions.push({ parentId: { not: null } });
    } else {
      conditions.push({ parentId: null });
    }
  }

  if (input.typeId) {
    conditions.push({ typeId: input.typeId });
  }

  const groupInput = input.stateGroup !== undefined && input.stateGroup !== null && input.stateGroup !== ""
    ? input.stateGroup
    : input.columnGroup;

  if (groupInput !== undefined && groupInput !== null && groupInput !== "") {
    const groupFilter = parseColumnGroupFilter(groupInput);
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
    const d = new Date(input.dueBefore);
    if (isNaN(d.getTime())) {
      return { success: false, error: "Invalid dueBefore date" };
    }
    dueDateCondition.lte = d;
  }

  if (input.dueAfter) {
    const d = new Date(input.dueAfter);
    if (isNaN(d.getTime())) {
      return { success: false, error: "Invalid dueAfter date" };
    }
    dueDateCondition.gte = d;
  }

  if (input.isOverdue === true) {
    dueDateCondition.lt = new Date();
    conditions.push({ completedAt: null });
  } else if (input.isOverdue === false) {
    conditions.push({
      OR: [
        { dueDate: null },
        { dueDate: { gte: new Date() } },
        { completedAt: { not: null } },
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

export interface CountCardsResult {
  count: number;
  groups?: Array<{ columnId?: string; priority?: string; labelId?: string; count: number }>;
}

export async function countCards(
  where: object,
  groupBy?: CardGroupBy | string | null
): Promise<CountCardsResult> {
  const total = await db.card.count({ where });

  if (!groupBy) {
    return { count: total };
  }

  const normalizedGroup = groupBy.trim().toLowerCase();
  if (normalizedGroup === "column" || normalizedGroup === "columnid") {
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

  if (normalizedGroup === "priority") {
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

  if (normalizedGroup === "label" || normalizedGroup === "labelid") {
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

  throw new Error(`Invalid groupBy: '${groupBy}'. Expected one of column, priority, label.`);
}
