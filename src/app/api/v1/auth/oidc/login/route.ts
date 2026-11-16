import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import {
  getOidcConfig,
  getOidcFlowCookiePath,
  getOidcRedirectUri,
  isOidcConfigured,
  OIDC_COOKIE_MAX_AGE,
  OIDC_FLOW_COOKIE_PREFIX,
  signOidcFlow,
} from "@/lib/oidc";
import { determineCookieSecurity, getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isOidcConfigured()) {
    return NextResponse.json({ error: "OIDC is not configured" }, { status: 404 });
  }

  const linkMode = request.nextUrl.searchParams.get("link") === "1";
  const session = linkMode ? await getSession() : null;
  if (linkMode && !session) {
    return NextResponse.redirect(new URL("/login", new URL(getOidcRedirectUri()).origin));
  }

  const publicOrigin = new URL(getOidcRedirectUri()).origin;

  try {
    const config = await getOidcConfig();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const authorizationUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: getOidcRedirectUri(),
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    const response = NextResponse.redirect(authorizationUrl);
    const isSecure = await determineCookieSecurity();
    const cookiePath = getOidcFlowCookiePath();
    const flowCookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax" as const,
      path: cookiePath,
      maxAge: OIDC_COOKIE_MAX_AGE,
    };

    // Prune older flow cookies to prevent header size overflow
    const existingFlowCookies = request.cookies
      .getAll()
      .filter((c) => c.name.startsWith(OIDC_FLOW_COOKIE_PREFIX));
    if (existingFlowCookies.length >= 5) {
      for (const oldCookie of existingFlowCookies.slice(0, existingFlowCookies.length - 4)) {
        response.cookies.delete({ name: oldCookie.name, path: cookiePath });
      }
    }

    const signedFlow = await signOidcFlow({
      verifier: codeVerifier,
      state,
      nonce,
      link: linkMode ? 1 : 0,
      linkUserId: session?.userId,
    });

    response.cookies.set(`${OIDC_FLOW_COOKIE_PREFIX}${state}`, signedFlow, flowCookieOptions);

    return response;
  } catch (error) {
    console.error("OIDC login error:", error);
    return NextResponse.redirect(new URL("/login?error=oidc_failed", publicOrigin));
  }
}
