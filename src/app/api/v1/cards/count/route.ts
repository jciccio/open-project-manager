import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { verifyProjectAccess } from "@/lib/permissions";
import {
  buildCardWhere,
  countCards,
  parseCardFilterParams,
  validateCardGroupBy,
} from "@/lib/cardFilters";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedParams = parseCardFilterParams(searchParams);
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error }, { status: 400 });
  }

  const { projectId, filterInput, groupBy } = parsedParams.data;

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
  } catch (err) {
    console.error("Failed to count cards:", err);
    return NextResponse.json({ error: "Failed to count cards" }, { status: 500 });
  }
}
