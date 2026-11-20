import { NextRequest, NextResponse } from "next/server";
import { getCookieOnlySession } from "@/lib/auth";
import { listDiscordLinksForUser, revokeDiscordLinkForUser } from "@/lib/integrations/discord";

async function requireCookieSession(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return {
      ok: false as const,
      error: NextResponse.json(
        { error: "Forbidden: Discord account links can only be managed from an interactive cookie session." },
        { status: 403 }
      ),
    };
  }

  const session = await getCookieOnlySession(request);
  if (!session) {
    return {
      ok: false as const,
      error: NextResponse.json(
        { error: "Unauthorized. Please sign in to manage Discord links." },
        { status: 401 }
      ),
    };
  }

  return { ok: true as const, session };
}

export async function GET(request: NextRequest) {
  const auth = await requireCookieSession(request);
  if (!auth.ok) return auth.error;

  const links = await listDiscordLinksForUser(auth.session.userId);
  return NextResponse.json({ links }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireCookieSession(request);
  if (!auth.ok) return auth.error;

  const linkId = request.nextUrl.searchParams.get("id")?.trim();
  if (!linkId) {
    return NextResponse.json({ error: "Missing required query parameter: id" }, { status: 400 });
  }

  const removed = await revokeDiscordLinkForUser(auth.session.userId, linkId);
  if (!removed) {
    return NextResponse.json({ error: "Discord link not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
