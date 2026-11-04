import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, handleSlackSlashCommand } from "@/lib/integrations/slack";

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

  // Parse application/x-www-form-urlencoded params
  const params = new URLSearchParams(rawBody);
  const command = params.get("command") || "/opm";
  const text = params.get("text") || "";
  const user_name = params.get("user_name") || undefined;
  const user_id = params.get("user_id") || undefined;
  const channel_id = params.get("channel_id") || undefined;

  try {
    const result = await handleSlackSlashCommand({
      command,
      text,
      user_name,
      user_id,
      channel_id,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Slack slash command error:", err);
    return NextResponse.json(
      { response_type: "ephemeral", text: "An error occurred while processing the Slack command." },
      { status: 200 }
    );
  }
}
