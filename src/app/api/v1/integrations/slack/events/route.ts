import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/integrations/slack";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  // In production or when SLACK_SIGNING_SECRET is configured, enforce signature check
  if (signingSecret) {
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

  // Handle events (e.g. link_shared, app_mention)
  if (body.type === "event_callback") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
