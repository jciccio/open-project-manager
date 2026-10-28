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

export function cardPageQuery(where: object, after: CardPosition | null, limit: number) {
  return {
    where: after
      ? {
          AND: [
            where,
            { OR: [{ order: { gt: after.order } }, { order: after.order, id: { gt: after.id } }] },
          ],
        }
      : where,
    orderBy: [{ order: "asc" as const }, { id: "asc" as const }],
    take: limit + 1,
  };
}

export function cardPage<T extends CardPosition>(rows: T[], limit: number) {
  const cards = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCardCursor(cards[cards.length - 1]) : null;
  return { cards, nextCursor };
}
