import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { reorderCards } from "@/lib/services/cards";
import { CardReorderSchema } from "@/lib/validation/cards";
import { parseInput } from "@/lib/validation/errors";
import { serviceErrorResponse } from "@/lib/api/serviceErrorResponse";

export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = parseInput(CardReorderSchema, await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const res = await reorderCards(parsed.data.items, session.userId);
    if (!res.success) {
      return serviceErrorResponse(res);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}

