import { after, NextRequest, NextResponse } from "next/server";
import {
  verifyDiscordSignature,
  handleDiscordInteraction,
  type DiscordInteraction,
  type DiscordInteractionResponse,
} from "@/lib/integrations/discord";

const DISCORD_SNOWFLAKE_RE = /^\d{1,30}$/;
const DISCORD_INTERACTION_TOKEN_RE = /^[A-Za-z0-9._-]{1,500}$/;

function buildDiscordErrorResponse(message: string): DiscordInteractionResponse {
  return {
    type: 4,
    data: {
      content: message,
      flags: 64,
    },
  };
}

export async function POST(request: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "Discord integration not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  const isValid = verifyDiscordSignature({
    publicKey,
    signature,
    timestamp,
    rawBody,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid Discord signature" }, { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // PING must always return PONG synchronously
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  const applicationId = typeof interaction.application_id === "string" ? interaction.application_id : "";
  const interactionToken = typeof interaction.token === "string" ? interaction.token : "";

  // When Discord supplies application_id and interaction token, acknowledge immediately
  // within Discord's 3-second deadline using Deferred Ephemeral Response (type 5)
  // and deliver the final result asynchronously via Next.js after().
  if (interaction.type === 2 && (applicationId || interactionToken)) {
    if (!DISCORD_SNOWFLAKE_RE.test(applicationId) || !DISCORD_INTERACTION_TOKEN_RE.test(interactionToken)) {
      return NextResponse.json({ error: "Invalid Discord interaction token or application_id" }, { status: 400 });
    }

    const followupUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
    const deferredWork = async () => {
      let result;
      try {
        result = await handleDiscordInteraction(interaction);
      } catch (err) {
        console.error("Discord interaction error:", err);
        result = buildDiscordErrorResponse(
          "An internal error occurred while processing the Discord interaction."
        );
      }

      const payload = {
        content: result.data?.content,
        embeds: result.data?.embeds,
        allowed_mentions: result.data?.allowed_mentions ?? { parse: [] },
      };

      try {
        const res = await fetch(followupUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          console.error(`Discord deferred followup failed: ${res.status}`);
        }
      } catch (err) {
        console.error("Discord deferred followup error:", err);
      }
    };

    try {
      after(deferredWork);
    } catch {
      // Outside Next.js request AsyncLocalStorage (e.g., direct route handler unit tests):
      // schedule onto the microtask queue so the type 5 ack returns immediately.
      void Promise.resolve().then(deferredWork);
    }

    return NextResponse.json({
      type: 5,
      data: { flags: 64 },
    });
  }

  try {
    const result = await handleDiscordInteraction(interaction);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Discord interaction error:", err);
    return NextResponse.json(
      buildDiscordErrorResponse("An internal error occurred while processing the Discord interaction."),
      { status: 200 }
    );
  }
}
