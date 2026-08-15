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

    const cardIds = items.map((i: any) => i.id);
    const existingCards = await db.card.findMany({
      where: {
        id: { in: cardIds },
        project: { userId: session.userId },
      },
      select: { id: true },
    });

    if (existingCards.length !== cardIds.length) {
      return NextResponse.json(
        { error: "Unauthorized or card not found" },
        { status: 400 }
      );
    }

    const updates = items.map((item: any) =>
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
