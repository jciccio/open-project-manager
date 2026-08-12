import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { createCard } from "@/actions/cards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const columnId = searchParams.get("columnId");
  const query = searchParams.get("query");
  const limitParam = searchParams.get("limit");
  const cursor = searchParams.get("cursor");

  let limit: number | undefined = undefined;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed)) {
      limit = Math.min(Math.max(1, parsed), 100);
    }
  } else if (cursor) {
    limit = 50;
  }

  try {
    const where: any = {
      ...(columnId
        ? { columnId }
        : projectId
        ? { project: { id: projectId, userId: session.userId } }
        : { project: { userId: session.userId } }),
    };
    if (query) {
      where.OR = [
        { title: { contains: query } },
        { description: { contains: query } },
      ];
    }

    const queryOptions: any = {
      where,
      include: {
        labels: { include: { label: true } },
        comments: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    };

    if (limit !== undefined) {
      queryOptions.take = limit;
    }

    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1;
    }

    const cards = await db.card.findMany(queryOptions);
    const nextCursor = limit !== undefined && cards.length === limit ? cards[cards.length - 1].id : null;

    return NextResponse.json({ success: true, data: cards, nextCursor });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch cards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const res = await createCard(
      {
        projectId: body.projectId,
        columnId: body.columnId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        points: body.points,
        owner: body.owner,
        dueDate: body.dueDate,
        labelIds: body.labelIds,
      },
      session.userId
    );

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
