import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { updateSavedView, deleteSavedView } from "@/actions/views";
import { db } from "@/lib/db";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const savedView = await db.savedView.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!savedView || savedView.project.userId !== session.userId) {
      return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: savedView });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch saved view" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const body = await request.json();
    const filterJson =
      typeof body.filterJson === "object" ? JSON.stringify(body.filterJson) : body.filterJson;

    const res = await updateSavedView(
      id,
      {
        name: body.name,
        filterJson,
        isDefault: body.isDefault,
      },
      session.userId
    );

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: res.data });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const res = await deleteSavedView(id, session.userId);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, deletedId: id });
}
