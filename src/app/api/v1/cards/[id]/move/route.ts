import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { moveCard } from "@/actions/cards";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;
  try {
    const body = await request.json();
    const { targetColumnId, newOrder = 0 } = body;

    if (!targetColumnId) {
      return NextResponse.json({ error: "targetColumnId is required" }, { status: 400 });
    }

    const res = await moveCard(cardId, targetColumnId, newOrder, session.userId);
    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
