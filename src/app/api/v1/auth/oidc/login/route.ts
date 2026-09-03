import { NextResponse } from "next/server";
import * as client from "openid-client";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured } from "@/lib/oidc";

const OIDC_COOKIE_MAX_AGE = 600; // 10 minutes — long enough to complete a login redirect

export async function GET() {
  if (!isOidcConfigured()) {
    return NextResponse.json({ error: "OIDC is not configured" }, { status: 404 });
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
  const isSecure =
    process.env.COOKIE_SECURE === "false"
      ? false
      : process.env.NODE_ENV === "production";
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

  return response;
}
