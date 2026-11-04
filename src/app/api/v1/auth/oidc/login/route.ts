import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { SignJWT } from "jose";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured } from "@/lib/oidc";
import { determineCookieSecurity, getSession } from "@/lib/auth";
import { JWT_SECRET } from "@/lib/env";
import { OIDC_FLOW_AUDIENCE, TOKEN_ISSUER } from "@/lib/tokenClaims";

const OIDC_COOKIE_MAX_AGE = 600; // 10 minutes — long enough to complete a login redirect

export async function GET(request: NextRequest) {
  if (!isOidcConfigured()) {
    return NextResponse.json({ error: "OIDC is not configured" }, { status: 404 });
  }

  const linkMode = request.nextUrl.searchParams.get("link") === "1";
  if (linkMode && !(await getSession())) {
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
    const flowCookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax" as const,
      path: "/api/v1/auth/oidc/callback",
      maxAge: OIDC_COOKIE_MAX_AGE,
    };

    const signedFlow = await new SignJWT({
      verifier: codeVerifier,
      state,
      nonce,
      link: linkMode ? 1 : 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(OIDC_FLOW_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${OIDC_COOKIE_MAX_AGE}s`)
      .sign(JWT_SECRET);

    response.cookies.set(`opm_oidc_flow_${state}`, signedFlow, flowCookieOptions);

    return response;
  } catch (error) {
    console.error("OIDC login error:", error);
    return NextResponse.redirect(new URL("/login?error=oidc_failed", publicOrigin));
  }
}
