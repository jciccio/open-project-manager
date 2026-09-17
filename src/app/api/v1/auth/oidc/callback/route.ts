import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { createSession } from "@/lib/auth";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured, resolveOidcUser } from "@/lib/oidc";

const OIDC_COOKIE_NAMES = ["opm_oidc_verifier", "opm_oidc_state", "opm_oidc_nonce"] as const;

function redirectToLogin(publicOrigin: string, error: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, publicOrigin));
  for (const name of OIDC_COOKIE_NAMES) {
    response.cookies.delete(name);
  }
  return response;
}

export async function GET(request: NextRequest) {
  if (!isOidcConfigured()) {
    return NextResponse.json({ error: "OIDC is not configured" }, { status: 404 });
  }

  // Never build absolute URLs from request.url/request.nextUrl in this route:
  // behind a reverse proxy that doesn't forward the original Host, it reflects
  // the container's own bind address (e.g. http://0.0.0.0:3000), not the
  // public URL — which also breaks the redirect_uri the token exchange sends
  // to the IdP, since openid-client derives it from the URL passed in below.
  const publicOrigin = new URL(getOidcRedirectUri()).origin;

  const codeVerifier = request.cookies.get("opm_oidc_verifier")?.value;
  const expectedState = request.cookies.get("opm_oidc_state")?.value;
  const expectedNonce = request.cookies.get("opm_oidc_nonce")?.value;

  if (!codeVerifier || !expectedState || !expectedNonce) {
    return redirectToLogin(publicOrigin, "oidc_session_expired");
  }

  try {
    const config = await getOidcConfig();
    const callbackUrl = new URL(getOidcRedirectUri());
    callbackUrl.search = request.nextUrl.search;
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState,
      expectedNonce,
    });

    const claims = tokens.claims();
    if (!claims) {
      throw new Error("OIDC callback did not return ID token claims");
    }

    const result = await resolveOidcUser({
      sub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : undefined,
    });

    if (!result.ok) {
      return redirectToLogin(publicOrigin, `oidc_${result.error}`);
    }

    await createSession({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
    });

    const response = NextResponse.redirect(new URL("/", publicOrigin));
    for (const name of OIDC_COOKIE_NAMES) {
      response.cookies.delete(name);
    }
    return response;
  } catch (error) {
    console.error("OIDC callback error:", error);
    return redirectToLogin(publicOrigin, "oidc_failed");
  }
}
