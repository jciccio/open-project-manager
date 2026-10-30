import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { verifyProjectAccess } from "@/lib/permissions";
import { buildCardWhere, countCards } from "@/lib/cardFilters";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const columnId = searchParams.get("columnId");
  const parentId = searchParams.get("parentId");
  const hasParentParam = searchParams.get("hasParent");
  const typeId = searchParams.get("typeId");
  const columnGroup = searchParams.get("columnGroup");
  const stateGroup = searchParams.get("stateGroup");
  const assignedUserId = searchParams.get("assignedUserId") || searchParams.get("assignedTo");
  const query = searchParams.get("query");
  const isArchivedParam = searchParams.get("isArchived");
  const isOverdueParam = searchParams.get("isOverdue");
  const dueBefore = searchParams.get("dueBefore");
  const dueAfter = searchParams.get("dueAfter");
  const groupBy = searchParams.get("groupBy");

  const labelIdsParam = [
    ...searchParams.getAll("labelIds"),
    ...(searchParams.get("labelId") ? [searchParams.get("labelId")!] : []),
  ];

  if (isArchivedParam !== null && isArchivedParam !== "true" && isArchivedParam !== "false") {
    return NextResponse.json({ error: "isArchived must be true or false" }, { status: 400 });
  }
  if (hasParentParam !== null && hasParentParam !== "true" && hasParentParam !== "false") {
    return NextResponse.json({ error: "hasParent must be true or false" }, { status: 400 });
  }
  if (isOverdueParam !== null && isOverdueParam !== "true" && isOverdueParam !== "false") {
    return NextResponse.json({ error: "isOverdue must be true or false" }, { status: 400 });
  }

  try {
    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
      if (!hasAccess) {
        return NextResponse.json({ success: true, count: 0 });
      }
    }

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

    const filterRes = buildCardWhere(
      {
        projectId,
        columnId,
        parentId,
        hasParent: hasParentParam === "true" ? true : hasParentParam === "false" ? false : undefined,
        typeId,
        columnGroup: columnGroup ?? undefined,
        stateGroup: stateGroup ?? undefined,
        assignedTo: assignedUserId,
        query,
        isArchived: isArchivedParam === "true",
        isOverdue: isOverdueParam === "true" ? true : isOverdueParam === "false" ? false : undefined,
        dueBefore,
        dueAfter,
        labelIds: labelIdsParam.length > 0 ? labelIdsParam : undefined,
      },
      accessibleScope
    );

    if (!filterRes.success) {
      return NextResponse.json({ error: filterRes.error }, { status: 400 });
    }

    try {
      const countRes = await countCards(filterRes.where, groupBy);
      return NextResponse.json({ success: true, ...countRes });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Failed to count cards" }, { status: 500 });
  }
}
