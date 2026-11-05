import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordSignature, handleDiscordInteraction, type DiscordInteraction } from "@/lib/integrations/discord";

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

  try {
    const result = await handleDiscordInteraction(interaction);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Discord interaction error:", err);
    return NextResponse.json(
      {
        type: 4,
        data: {
          content: "An internal error occurred while processing the Discord interaction.",
          flags: 64,
        },
      },
      { status: 200 }
    );
  }
}
