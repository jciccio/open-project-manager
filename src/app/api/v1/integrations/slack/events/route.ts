import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/integrations/slack";

export async function POST(request: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: "Slack integration not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");

  const isValid = verifySlackSignature({
    signingSecret,
    signature,
    timestamp,
    rawBody,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Handle Slack URL verification challenge
  if (body.type === "url_verification" && typeof body.challenge === "string") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Acknowledge signed event callbacks (automatic link_shared unfurling and
  // channel notifications require Bot Token subscription wiring in follow-up work).
  return NextResponse.json({ ok: true });
}
