import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { listComments, addComment } from "@/lib/services/comments";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;
  const res = await listComments(cardId, session.userId);

  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;

  try {
    const body = await request.json();
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "Comment content is required" }, { status: 400 });
    }

    const author = typeof body.author === "string" ? body.author : session.name;
    const res = await addComment(cardId, author, body.content, session.userId);

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
