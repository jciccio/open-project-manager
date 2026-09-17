import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { uploadAttachment, listAttachments } from "@/actions/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachmentStorage";

// Base64 JSON bodies inflate the raw byte count to ~4/3 of the decoded size,
// plus a little slack for JSON/multipart framing overhead.
const MAX_REQUEST_BYTES = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

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

  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB attachment size limit` },
      { status: 413 }
    );
  }

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
