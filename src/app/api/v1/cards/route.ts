import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { createCard } from "@/lib/services/cards";
import { db } from "@/lib/db";
import { cardPage, cardPageQuery, decodeCardCursor, fetchCardsByPriority } from "@/lib/cardPagination";
import { verifyProjectAccess } from "@/lib/permissions";
import {
  buildCardWhere,
  parseCardFilterParams,
  parseCardOrderBy,
  countCards,
  validateCardGroupBy,
} from "@/lib/cardFilters";
import { serviceErrorResponse } from "@/lib/api/serviceErrorResponse";

const DEFAULT_LIST_CARDS_LIMIT = 100;

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedParams = parseCardFilterParams(searchParams, DEFAULT_LIST_CARDS_LIMIT);
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error }, { status: 400 });
  }

  const { projectId, filterInput, groupBy, orderBy, orderDirection, limit, cursor, count } = parsedParams.data;

  try {
    const accessibleScope = projectId
      ? undefined
      : {
          project: {
            OR: [
              { userId: session.userId },
              { members: { some: { userId: session.userId } } },
            ],
          },
        };

    const filterRes = buildCardWhere(filterInput, accessibleScope);
    if (!filterRes.success) {
      return NextResponse.json({ error: filterRes.error }, { status: 400 });
    }

    if (count) {
      const groupValidation = validateCardGroupBy(groupBy);
      if (!groupValidation.success) {
        return NextResponse.json({ error: groupValidation.error }, { status: 400 });
      }
      if (projectId) {
        const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
        if (!hasAccess) {
          return NextResponse.json({
            success: true,
            count: 0,
            ...(groupValidation.groupBy ? { groups: [] } : {}),
          });
        }
      }
      const countRes = await countCards(filterRes.where, groupValidation.groupBy);
      return NextResponse.json({ success: true, ...countRes });
    }

    const sortRes = parseCardOrderBy(orderBy, orderDirection);
    if (!sortRes.success) {
      return NextResponse.json({ error: sortRes.error }, { status: 400 });
    }

    if (cursor && sortRes.sort.field !== "order") {
      return NextResponse.json({ error: "Cursor pagination is only supported with orderBy=order" }, { status: 400 });
    }

    const after = cursor ? decodeCardCursor(cursor) : null;
    if (cursor && !after) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
      if (!hasAccess) {
        return NextResponse.json({ success: true, data: [], nextCursor: null });
      }
    }

    const includeOptions = {
      type: true,
      labels: { include: { label: true } },
      comments: {
        orderBy: { createdAt: "asc" as const },
        include: { authorUser: { select: { id: true, name: true, email: true } } },
      },
      assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
      parent: { select: { id: true, number: true, title: true } },
      children: { select: { id: true, number: true, title: true, completedAt: true } },
    };

    if (sortRes.sort.field === "priority") {
      const { cards, nextCursor } = await fetchCardsByPriority(
        filterRes.where,
        limit,
        sortRes.sort.direction,
        includeOptions
      );
      return NextResponse.json({ success: true, data: cards, nextCursor });
    }

    const queryOptions: any = {
      ...cardPageQuery(filterRes.where, after, limit, sortRes.sort),
      include: includeOptions,
    };

    const rows = await db.card.findMany(queryOptions);
    const { cards, nextCursor } = cardPage(rows, limit, sortRes.sort.field);

    return NextResponse.json({ success: true, data: cards, nextCursor });
  } catch (err) {
    console.error("Failed to fetch cards:", err);
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
      return serviceErrorResponse(res);
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
