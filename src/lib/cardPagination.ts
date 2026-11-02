type CardPosition = { order: number; id: string };

export function encodeCardCursor(card: CardPosition): string {
  return Buffer.from(JSON.stringify([card.order, card.id])).toString("base64url");
}

export function decodeCardCursor(cursor: string): CardPosition | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isInteger(parsed[0]) && typeof parsed[1] === "string") {
      return { order: parsed[0], id: parsed[1] };
    }
  } catch {}
  return null;
}

export function cardPageQuery(
  where: object,
  after: CardPosition | null,
  limit: number,
  sort?: { field: string; direction: "asc" | "desc" }
) {
  const direction = sort?.direction ?? "asc";
  const field = sort?.field ?? "order";

  let orderByClause: any[];
  if (field === "dueDate") {
    orderByClause = [{ dueDate: { sort: direction, nulls: "last" as const } }, { id: "asc" as const }];
  } else if (field === "priority") {
    orderByClause = [{ id: "asc" as const }];
  } else if (field === "order") {
    orderByClause = [{ order: direction }, { id: direction }];
  } else {
    orderByClause = [{ [field]: direction }, { id: "asc" as const }];
  }

  const afterCondition = after
    ? direction === "desc"
      ? { OR: [{ order: { lt: after.order } }, { order: after.order, id: { lt: after.id } }] }
      : { OR: [{ order: { gt: after.order } }, { order: after.order, id: { gt: after.id } }] }
    : undefined;

  const finalWhere = afterCondition
    ? { AND: [where, afterCondition] }
    : where;

  return {
    where: finalWhere,
    orderBy: orderByClause,
    ...(field === "priority" ? {} : { take: limit + 1 }),
  };
}

export function cardPage<T extends CardPosition>(
  rows: T[],
  limit: number,
  sortField?: string
) {
  const cards = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && (!sortField || sortField === "order")
      ? encodeCardCursor(cards[cards.length - 1])
      : null;
  return { cards, nextCursor };
}
