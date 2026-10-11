import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { createCard } from "@/lib/services/cards";
import { db } from "@/lib/db";
import { cardPage, cardPageQuery, decodeCardCursor } from "@/lib/cardPagination";
import { verifyProjectAccess } from "@/lib/permissions";

const DEFAULT_LIST_CARDS_LIMIT = 100;

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const columnId = searchParams.get("columnId");
  const parentId = searchParams.get("parentId");
  const typeId = searchParams.get("typeId");
  const assignedUserId = searchParams.get("assignedUserId") || searchParams.get("assignedTo");
  const query = searchParams.get("query");
  const limitParam = searchParams.get("limit");
  const cursor = searchParams.get("cursor");
  const isArchivedParam = searchParams.get("isArchived");

  let limit: number = DEFAULT_LIST_CARDS_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed)) {
      limit = Math.min(Math.max(1, parsed), 100);
    }
  }

  const after = cursor ? decodeCardCursor(cursor) : null;
  if (cursor && !after) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }
  if (isArchivedParam !== null && isArchivedParam !== "true" && isArchivedParam !== "false") {
    return NextResponse.json({ error: "isArchived must be true or false" }, { status: 400 });
  }

  try {
    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
      if (!hasAccess) {
        return NextResponse.json({ success: true, data: [], nextCursor: null });
      }
    }

    const where: any = {
      isArchived: isArchivedParam === "true",
      ...(columnId ? { columnId } : {}),
      ...(projectId
        ? { projectId }
        : {
            project: {
              OR: [
                { userId: session.userId },
                { members: { some: { userId: session.userId } } },
              ],
            },
          }),
    };
    if (parentId !== null) {
      where.parentId = parentId === "null" ? null : parentId;
    }
    if (typeId) {
      where.typeId = typeId;
    }
    if (assignedUserId) {
      where.assignees = { some: { userId: assignedUserId } };
    }
    if (query) {
      where.OR = [
        { title: { contains: query } },
        { description: { contains: query } },
      ];
    }

    const queryOptions: any = {
      ...cardPageQuery(where, after, limit),
      include: {
        type: true,
        labels: { include: { label: true } },
        comments: { orderBy: { createdAt: "asc" } },
        assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
        parent: { select: { id: true, number: true, title: true } },
        children: { select: { id: true, number: true, title: true, completedAt: true } },
      },
    };

    const { cards, nextCursor } = cardPage(await db.card.findMany(queryOptions), limit);

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
        parentId: body.parentId,
        typeId: body.typeId,
        labelIds: body.labelIds,
        assigneeIds: body.assigneeIds,
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
