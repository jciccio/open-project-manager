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

  try {
    const cards = await db.card.findMany({
      where: {
        ...(columnId
          ? { columnId }
          : projectId
          ? { project: { id: projectId, userId: session.userId } }
          : { project: { userId: session.userId } }),
      },
      include: {
        labels: { include: { label: true } },
        comments: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { order: "asc" },
    });

    return NextResponse.json({ success: true, data: cards });
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
