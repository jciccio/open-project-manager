import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { createColumn } from "@/lib/services/columns";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "Column name is required" }, { status: 400 });
    }

    const res = await createColumn(projectId, body.name, body.isDone, session.userId);
    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
