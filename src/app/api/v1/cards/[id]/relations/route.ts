import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { addCardRelation, getCardRelations } from "@/lib/services/relations";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;
  const res = await getCardRelations(cardId, session.userId);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}

export async function POST(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sourceCardId } = await params;
  try {
    const body = await request.json();
    if (!body.targetCardId) {
      return NextResponse.json({ error: "targetCardId is required" }, { status: 400 });
    }

    const res = await addCardRelation(sourceCardId, body.targetCardId, body.type || "BLOCKS", session.userId);
    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
