import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { addCardLink } from "@/actions/cards";

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
    if (!body.url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const res = await addCardLink(cardId, body.url, body.title, session.userId);

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    console.error("Error in POST /api/v1/cards/[id]/links:", err);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
