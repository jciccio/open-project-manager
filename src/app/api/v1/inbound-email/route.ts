import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { processInboundEmail } from "@/lib/inboundEmail";
import { getApiSession } from "@/lib/auth";

const inboundSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const configuredToken = process.env.INBOUND_EMAIL_TOKEN;
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const customHeaderToken = request.headers.get("x-inbound-token");
  const tokenProvided = bearerToken || customHeaderToken;

  let isWebhookAuthorized = false;
  if (configuredToken && tokenProvided) {
    const bufProvided = Buffer.from(tokenProvided);
    const bufConfigured = Buffer.from(configuredToken);
    if (bufProvided.length === bufConfigured.length && crypto.timingSafeEqual(bufProvided, bufConfigured)) {
      isWebhookAuthorized = true;
    }
  }

  let sessionUser: { id: string; email: string } | null = null;
  if (!isWebhookAuthorized) {
    const session = await getApiSession(request);
    if (session && session.email) {
      sessionUser = { id: session.userId, email: session.email };
    }
  }

  if (!isWebhookAuthorized && !sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized: valid Bearer token or configured INBOUND_EMAIL_TOKEN required" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid inbound email payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  let payloadData = parsed.data;
  if (sessionUser) {
    // If authenticated via user session, ignore client-provided `from` to prevent spoofing
    payloadData = {
      ...payloadData,
      from: sessionUser.email,
    };
  }

  const result = await processInboundEmail(payloadData);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ success: true, data: result.card }, { status: 201 });
}
