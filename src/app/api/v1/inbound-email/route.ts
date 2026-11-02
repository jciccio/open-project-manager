import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { processInboundEmail } from "@/lib/inboundEmail";
import { getApiSession } from "@/lib/auth";
import { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/validation/cards";

const inboundSchema = z.object({
  to: z.string().min(1).max(2000),
  from: z.string().min(1).max(2000),
  subject: z.string().trim().min(1, "Email subject is required").max(MAX_TITLE_LENGTH),
  text: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  html: z.string().max(MAX_DESCRIPTION_LENGTH * 4).optional(),
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

  try {
    const result = await processInboundEmail(payloadData);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error, accepted: false }, { status: 200 });
    }

    return NextResponse.json({ success: true, accepted: true, data: result.card }, { status: 201 });
  } catch (error) {
    console.error("Error processing inbound email:", error);
    return NextResponse.json(
      { error: "Failed to process inbound email", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
