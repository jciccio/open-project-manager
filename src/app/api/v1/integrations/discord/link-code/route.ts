import { NextRequest, NextResponse } from "next/server";
import { getCookieOnlySession } from "@/lib/auth";
import { issueDiscordLinkCode } from "@/lib/integrations/discord";

/**
 * Generates a short-lived, single-use code for linking a Discord account via `/opm link <code>`
 * so users never have to paste long-lived API tokens into Discord chat.
 *
 * NOTE: To prevent leaked API tokens from being used to mint permanent unrevocable Discord links,
 * this endpoint strictly requires an interactive user session cookie and rejects Bearer API tokens.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Forbidden: Discord link codes cannot be generated using an API token. An interactive cookie session is required." },
      { status: 403 }
    );
  }

  const session = await getCookieOnlySession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized. Please sign in with an interactive browser session to generate a Discord link code." },
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
