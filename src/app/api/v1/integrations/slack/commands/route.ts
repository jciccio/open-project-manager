import { after, NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, handleSlackSlashCommand } from "@/lib/integrations/slack";

function isValidSlackResponseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return parsed.hostname === "hooks.slack.com" || parsed.hostname.endsWith(".slack.com");
  } catch {
    return false;
  }
}

async function runSlashCommandSafe(params: {
  command: string;
  text: string;
  user_id?: string;
}) {
  try {
    return await handleSlackSlashCommand(params);
  } catch (err) {
    console.error("Slack slash command error:", err);
    return {
      response_type: "ephemeral" as const,
      text: "An error occurred while processing the Slack command.",
    };
  }
}

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
  const user_id = params.get("user_id") || undefined;
  const responseUrl = params.get("response_url")?.trim() || "";

  if (responseUrl) {
    if (!isValidSlackResponseUrl(responseUrl)) {
      return NextResponse.json({ error: "Invalid Slack response_url" }, { status: 400 });
    }

    const deferredWork = async () => {
      const result = await runSlashCommandSafe({ command, text, user_id });
      try {
        const res = await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          console.error(`Slack response_url callback failed: ${res.status}`);
        }
      } catch (err) {
        console.error("Slack response_url callback error:", err);
      }
    };

    try {
      after(deferredWork);
    } catch {
      // Outside Next.js request AsyncLocalStorage (e.g., direct route handler unit tests):
      // schedule onto the microtask queue so the HTTP 200 ack still returns immediately.
      void Promise.resolve().then(deferredWork);
    }

    return NextResponse.json({
      response_type: "ephemeral",
      text: "Processing command...",
    });
  }

  const result = await runSlashCommandSafe({ command, text, user_id });
  return NextResponse.json(result);
}
