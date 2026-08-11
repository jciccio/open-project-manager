import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { deleteAttachment } from "@/actions/attachments";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: attachmentId } = await params;
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId },
    include: { card: { include: { project: true } } },
  });

  if (!attachment || attachment.card.project.userId !== session.userId) {
    return NextResponse.json({ error: "Attachment not found or access denied" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "public", "uploads", "attachments", attachment.storageKey);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const fileStream = fs.readFileSync(filePath);
  return new NextResponse(fileStream, {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: attachmentId } = await params;
  const res = await deleteAttachment(attachmentId, session.userId);

  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}
