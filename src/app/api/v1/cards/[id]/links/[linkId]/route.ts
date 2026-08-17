import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { removeCardLink } from "@/actions/cards";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { linkId } = await params;

  try {
    const res = await removeCardLink(linkId);

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, deletedId: linkId }, { status: 200 });
  } catch (err) {
    console.error("Error in DELETE /api/v1/cards/[id]/links/[linkId]:", err);
    return NextResponse.json({ error: "Failed to delete link" }, { status: 400 });
  }
}
