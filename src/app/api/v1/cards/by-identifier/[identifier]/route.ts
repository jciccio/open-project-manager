import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getCardByIdentifier } from "@/actions/cards";

interface Props {
  params: Promise<{ identifier: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { identifier } = await params;
  const result = await getCardByIdentifier(identifier, session.userId);

  if (!result.success) {
    const status = result.error?.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
