import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { updateWebhook, deleteWebhook } from "@/actions/webhooks";
import { db } from "@/lib/db";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const webhook = await db.webhook.findUnique({
      where: { id },
      include: { project: true },
      omit: { secret: true },
    });

    if (!webhook || webhook.project.userId !== session.userId) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: webhook });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch webhook" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const body = await request.json();

    const res = await updateWebhook(
      id,
      {
        url: body.url,
        events: body.events,
        isActive: body.isActive,
      },
      session.userId
    );

    if (!res.success) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: res.data });
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const res = await deleteWebhook(id, session.userId);
  if (!res.success) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, deletedId: id });
}
