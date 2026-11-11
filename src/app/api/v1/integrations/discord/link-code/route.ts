import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth";
import { issueDiscordLinkCode } from "@/lib/integrations/discord";

/**
 * Generates a short-lived, single-use code for linking a Discord account via `/opm link <code>`
 * so users never have to paste long-lived API tokens into Discord chat.
 */
export async function POST(request: NextRequest) {
  const session = await getApiSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized. Please sign in or provide an API token." },
      { status: 401 }
    );
  }

  const { code, expiresAt } = await issueDiscordLinkCode(session.userId);
  return NextResponse.json(
    {
      code,
      expiresAt: expiresAt.toISOString(),
      command: `/opm link ${code}`,
    },
    { status: 201 }
  );
}
