import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getCardActivity } from "@/lib/services/activity";

export async function GET(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const cardId = searchParams.get("cardId");

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }

  const res = await getCardActivity(cardId, session.userId);

  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}
