import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured } from "@/lib/oidc";
import { determineCookieSecurity, getSession } from "@/lib/auth";

const OIDC_COOKIE_MAX_AGE = 600; // 10 minutes — long enough to complete a login redirect

export async function GET(request: NextRequest) {
  if (!isOidcConfigured()) {
    return NextResponse.json({ error: "OIDC is not configured" }, { status: 404 });
  }

  const linkMode = request.nextUrl.searchParams.get("link") === "1";
  if (linkMode && !(await getSession())) {
    return NextResponse.redirect(new URL("/login", new URL(getOidcRedirectUri()).origin));
  }

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
  const cookieOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: OIDC_COOKIE_MAX_AGE,
  };
  response.cookies.set("opm_oidc_verifier", codeVerifier, cookieOptions);
  response.cookies.set("opm_oidc_state", state, cookieOptions);
  response.cookies.set("opm_oidc_nonce", nonce, cookieOptions);
  if (linkMode) {
    response.cookies.set("opm_oidc_link", "1", cookieOptions);
  } else {
    response.cookies.delete("opm_oidc_link");
  }

  return response;
}
