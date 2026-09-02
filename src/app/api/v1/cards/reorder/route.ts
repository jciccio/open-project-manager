import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items array is required" }, { status: 400 });
    }

    const reorderItems = items as { id: string; order: number; columnId?: string }[];

    const cardIds = reorderItems.map((i) => i.id);
    const existingCards = await db.card.findMany({
      where: {
        id: { in: cardIds },
        project: { userId: session.userId },
      },
      select: { id: true, projectId: true },
    });

    if (existingCards.length !== cardIds.length) {
      return NextResponse.json(
        { error: "Unauthorized or card not found" },
        { status: 400 }
      );
    }
    const projectIdByCardId = new Map(existingCards.map((c) => [c.id, c.projectId]));

    const columnIds = [...new Set(reorderItems.map((i) => i.columnId).filter((id): id is string => !!id))];
    const columns = await db.column.findMany({
      where: { id: { in: columnIds } },
      select: { id: true, projectId: true },
    });
    const projectIdByColumnId = new Map(columns.map((c) => [c.id, c.projectId]));

    for (const item of reorderItems) {
      if (item.columnId && projectIdByColumnId.get(item.columnId) !== projectIdByCardId.get(item.id)) {
        return NextResponse.json({ error: "Invalid column" }, { status: 400 });
      }
    }

    const updates = reorderItems.map((item) =>
      db.card.update({
        where: { id: item.id },
        data: {
          order: item.order,
          ...(item.columnId ? { columnId: item.columnId } : {}),
        },
      })
    );

    await db.$transaction(updates);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
