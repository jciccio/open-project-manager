import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { getCardByIdentifier } from "@/lib/services/cards";
import { serviceErrorResponse } from "@/lib/api/serviceErrorResponse";

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
    return serviceErrorResponse(result);
  }

  return NextResponse.json({ success: true, data: result.data });
}
