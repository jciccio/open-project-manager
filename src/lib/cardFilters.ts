import { z } from "zod";
import { db } from "@/lib/db";
import { cardTextSearch } from "@/lib/cardSearch";
import { parseColumnGroupFilter } from "@/lib/columnGroups";
import { startOfUtcToday } from "@/lib/services/projectStats";
import { MAX_CARD_REFERENCE_IDS } from "@/lib/validation/cards";

export const CARD_SORT_FIELDS = ["order", "createdAt", "updatedAt", "dueDate", "priority"] as const;
export type CardSortField = (typeof CARD_SORT_FIELDS)[number];

/** Parse YYYY-MM-DD (expanding to UTC start/end of day) or full ISO date, rejecting rollover dates like 2026-02-31. */
function parseIsoOrDateOnly(value: string | Date, bound: "start" | "end"): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const d = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        bound === "end" ? 23 : 0,
        bound === "end" ? 59 : 0,
        bound === "end" ? 59 : 0,
        bound === "end" ? 999 : 0
      )
    );
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return d;
  }

  // Also reject calendar rollovers on ISO date prefixes like 2026-02-31T00:00:00Z.
  const isoPrefixMatch = /^(\d{4})-(\d{2})-(\d{2})[T\s]/.exec(trimmed);
  if (isoPrefixMatch) {
    const year = Number(isoPrefixMatch[1]);
    const month = Number(isoPrefixMatch[2]);
    const day = Number(isoPrefixMatch[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
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
  if (input.labelIds !== undefined && input.labelIds !== null) {
    const rawIds = Array.isArray(input.labelIds)
      ? input.labelIds.flatMap((id) => String(id).split(","))
      : typeof input.labelIds === "string"
        ? input.labelIds.split(",")
        : [];
    const labelIds = Array.from(new Set(rawIds.map((id) => id.trim()).filter(Boolean)));
    if (labelIds.length === 0) {
      return { success: false, error: "labelIds cannot be empty" };
    }
    if (labelIds.length > MAX_CARD_REFERENCE_IDS) {
      return { success: false, error: `labelIds cannot exceed ${MAX_CARD_REFERENCE_IDS} items` };
    }
    conditions.push({ labels: { some: { labelId: { in: labelIds } } } });
  }

  // Due date & overdue filtering
  const dueDateCondition: any = {};
  if (input.dueBefore !== undefined && input.dueBefore !== null) {
    const d = parseIsoOrDateOnly(input.dueBefore, "end");
    if (!d) {
      return { success: false, error: "Invalid dueBefore date" };
    }
    dueDateCondition.lte = d;
  }

  if (input.dueAfter !== undefined && input.dueAfter !== null) {
    const d = parseIsoOrDateOnly(input.dueAfter, "start");
    if (!d) {
      return { success: false, error: "Invalid dueAfter date" };
    }
    dueDateCondition.gte = d;
  }

  // Matches dashboard stats rule (projectStats.ts): dueDate < startOfUtcToday, open, non-cancelled.
  if (input.isOverdue === true) {
    const today = startOfUtcToday(new Date());
    dueDateCondition.lt = today;
    conditions.push({
      column: { isDone: false, group: { not: "CANCELLED" } },
    });
  } else if (input.isOverdue === false) {
    const today = startOfUtcToday(new Date());
    conditions.push({
      OR: [
        { dueDate: null },
        { dueDate: { gte: today } },
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
  orderBy?: unknown,
  orderDirection?: unknown
): ParseCardOrderByResult {
  if (orderBy !== undefined && orderBy !== null && typeof orderBy !== "string") {
    return { success: false, error: "orderBy must be a string." };
  }
  if (orderDirection !== undefined && orderDirection !== null && typeof orderDirection !== "string") {
    return { success: false, error: "orderDirection must be a string." };
  }

  let dirPart = typeof orderDirection === "string" ? orderDirection.trim().toLowerCase() : undefined;
  if (typeof orderDirection === "string" && !dirPart) {
    return { success: false, error: `Invalid orderDirection '${orderDirection}'. Expected asc or desc.` };
  }
  if (dirPart && dirPart !== "asc" && dirPart !== "desc") {
    return { success: false, error: `Invalid orderDirection '${orderDirection}'. Expected asc or desc.` };
  }

  if (orderBy === undefined || orderBy === null) {
    return { success: true, sort: { field: "order", direction: (dirPart as "asc" | "desc") || "asc" } };
  }

  let fieldPart = orderBy.trim();
  if (!fieldPart) {
    return {
      success: false,
      error: `Invalid orderBy '${orderBy}'. Expected one of created, createdAt, updated, updatedAt, due, dueDate, priority, order.`,
    };
  }

  if (fieldPart.includes(":")) {
    const parts = fieldPart.split(":");
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      return {
        success: false,
        error: `Invalid orderBy '${orderBy}'. Expected field or field:asc|desc.`,
      };
    }
    fieldPart = parts[0].trim();
    const colonDir = parts[1].trim().toLowerCase();
    if (colonDir !== "asc" && colonDir !== "desc") {
      return {
        success: false,
        error: `Invalid orderDirection '${colonDir}'. Expected asc or desc.`,
      };
    }
    if (!dirPart) {
      dirPart = colonDir;
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

  const direction: "asc" | "desc" = dirPart === "desc" ? "desc" : "asc";
  return { success: true, sort: { field, direction } };
}

export type CardGroupBy = "column" | "priority" | "label";

export function validateCardGroupBy(
  groupBy?: unknown
): { success: true; groupBy?: CardGroupBy } | { success: false; error: string } {
  if (groupBy === undefined || groupBy === null) return { success: true };
  if (typeof groupBy !== "string") {
    return { success: false, error: "groupBy must be a string." };
  }
  const normalized = groupBy.trim().toLowerCase();
  if (!normalized) {
    return { success: false, error: `Invalid groupBy '${groupBy}'. Expected one of column, priority, label.` };
  }
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

function parseBoolParam(raw: string | null, name: string): { ok: true; value?: boolean } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: undefined };
  if (raw === "true") return { ok: true, value: true };
  if (raw === "false") return { ok: true, value: false };
  return { ok: false, error: `${name} must be true or false` };
}

export interface ParsedCardQueryParams {
  projectId: string | null;
  filterInput: CardFilterInput;
  groupBy: string | null;
  orderBy: string | null;
  orderDirection: string | null;
  limit: number;
  cursor: string | null;
  count: boolean;
}

export function parseCardFilterParams(
  searchParams: URLSearchParams,
  defaultLimit = 100
): { success: true; data: ParsedCardQueryParams } | { success: false; error: string } {
  const isArchived = parseBoolParam(searchParams.get("isArchived"), "isArchived");
  if (!isArchived.ok) return { success: false, error: isArchived.error };

  const hasParent = parseBoolParam(searchParams.get("hasParent"), "hasParent");
  if (!hasParent.ok) return { success: false, error: hasParent.error };

  const isOverdue = parseBoolParam(searchParams.get("isOverdue"), "isOverdue");
  if (!isOverdue.ok) return { success: false, error: isOverdue.error };

  const count = parseBoolParam(searchParams.get("count"), "count");
  if (!count.ok) return { success: false, error: count.error };

  let limit = defaultLimit;
  const limitParam = searchParams.get("limit");
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed)) {
      limit = Math.min(Math.max(1, parsed), 100);
    }
  }

  const hasLabelIds = searchParams.has("labelIds") || searchParams.has("labelId");
  const labelIdsParam = [
    ...searchParams.getAll("labelIds"),
    ...(searchParams.get("labelId") ? [searchParams.get("labelId")!] : []),
  ];

  const projectId = searchParams.get("projectId");

  return {
    success: true,
    data: {
      projectId,
      filterInput: {
        projectId,
        columnId: searchParams.get("columnId"),
        priority: searchParams.get("priority"),
        owner: searchParams.get("owner"),
        parentId: searchParams.has("parentId") ? searchParams.get("parentId") : undefined,
        hasParent: hasParent.value,
        typeId: searchParams.get("typeId"),
        columnGroup: searchParams.has("columnGroup") ? searchParams.get("columnGroup") : undefined,
        stateGroup: searchParams.has("stateGroup") ? searchParams.get("stateGroup") : undefined,
        assignedTo: searchParams.get("assignedUserId") || searchParams.get("assignedTo"),
        query: searchParams.get("query"),
        isArchived: isArchived.value ?? false,
        isOverdue: isOverdue.value,
        dueBefore: searchParams.has("dueBefore") ? searchParams.get("dueBefore") : undefined,
        dueAfter: searchParams.has("dueAfter") ? searchParams.get("dueAfter") : undefined,
        labelIds: hasLabelIds ? labelIdsParam : undefined,
      },
      groupBy: searchParams.has("groupBy") ? searchParams.get("groupBy") : null,
      orderBy: searchParams.has("orderBy") ? searchParams.get("orderBy") : null,
      orderDirection: searchParams.has("orderDirection") ? searchParams.get("orderDirection") : null,
      limit,
      cursor: searchParams.get("cursor") || searchParams.get("after"),
      count: count.value === true,
    },
  };
}

const cardFilterArgsShape = {
  projectId: z.string().optional(),
  columnId: z.string().optional(),
  priority: z.string().optional(),
  owner: z.string().optional(),
  assignedTo: z.string().optional(),
  query: z.string().optional(),
  parentId: z.string().nullable().optional(),
  hasParent: z.boolean().optional(),
  typeId: z.string().optional(),
  columnGroup: z.union([z.string(), z.array(z.string())]).optional(),
  stateGroup: z.union([z.string(), z.array(z.string())]).optional(),
  labelIds: z.union([z.string(), z.array(z.string())]).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  isOverdue: z.boolean().optional(),
  isArchived: z.boolean().optional(),
};

export const McpCountCardsArgsSchema = z
  .object({
    ...cardFilterArgsShape,
    groupBy: z.string().optional(),
  })
  .passthrough();

export const McpListCardsArgsSchema = z
  .object({
    ...cardFilterArgsShape,
    orderBy: z.string().optional(),
    orderDirection: z.string().optional(),
    count: z.boolean().optional(),
    groupBy: z.string().optional(),
    limit: z.union([z.number(), z.string().regex(/^\d+$/)]).optional(),
    cursor: z.string().optional(),
    after: z.string().optional(),
  })
  .passthrough();
