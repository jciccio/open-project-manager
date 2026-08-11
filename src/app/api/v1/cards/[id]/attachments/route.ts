import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { uploadAttachment, listAttachments } from "@/actions/attachments";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;
  const res = await listAttachments(cardId, session.userId);

  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: res.data });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cardId } = await params;

  try {
    const contentType = request.headers.get("content-type") || "";
    let filename: string;
    let buffer: Buffer;
    let mimeType: string | undefined;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      if (!body.filename || !body.contentBase64) {
        return NextResponse.json({ error: "Missing filename or contentBase64" }, { status: 400 });
      }
      filename = body.filename;
      buffer = Buffer.from(body.contentBase64, "base64");
      mimeType = body.mimeType;
    } else {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      filename = file.name;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = file.type || undefined;
    }

    const res = await uploadAttachment(
      {
        cardId,
        filename,
        contentBuffer: buffer,
        mimeType,
        uploadedBy: session.userId,
      },
      session.userId
    );

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: res.data }, { status: 201 });
  } catch (err) {
    console.error("Error in POST /api/v1/cards/[id]/attachments:", err);
    return NextResponse.json({ error: "Invalid form payload" }, { status: 400 });
  }
}
