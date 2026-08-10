import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { removeCardRelation } from "@/actions/relations";

interface Props {
  params: Promise<{ id: string; relationId: string }>;
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { relationId } = await params;
  const res = await removeCardRelation(relationId, session.userId);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
