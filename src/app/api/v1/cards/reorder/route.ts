import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { reorderCards } from "@/lib/services/cards";

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items array is required" }, { status: 400 });
    }

    const res = await reorderCards(items, session.userId);
    if (!res.success) {
      return NextResponse.json(
        { error: res.error || "Unauthorized or card not found" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}

