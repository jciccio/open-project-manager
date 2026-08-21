import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getSavedViews, createSavedView } from "@/actions/views";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const res = await getSavedViews(projectId, session.userId);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "View name is required" }, { status: 400 });
    }
    if (!body.projectId || typeof body.projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const filterJson = typeof body.filterJson === "object" ? JSON.stringify(body.filterJson) : body.filterJson;

    const res = await createSavedView(
      body.projectId,
      {
        name: body.name,
        filterJson: filterJson || "{}",
        isDefault: body.isDefault,
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
