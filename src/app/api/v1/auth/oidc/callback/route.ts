import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { jwtVerify } from "jose";
import { createSession, getSession } from "@/lib/auth";
import { JWT_SECRET } from "@/lib/env";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured, resolveOidcUser } from "@/lib/oidc";
import { OIDC_FLOW_AUDIENCE, TOKEN_ISSUER } from "@/lib/tokenClaims";

const OIDC_COOKIE_NAMES = ["opm_oidc_verifier", "opm_oidc_state", "opm_oidc_nonce", "opm_oidc_link"] as const;
const STATE_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

function redirectClearingFlow(url: URL, state?: string | null) {
  const response = NextResponse.redirect(url);
  for (const name of OIDC_COOKIE_NAMES) {
    response.cookies.delete({ name, path: "/" });
  }
  if (state && STATE_REGEX.test(state)) {
    response.cookies.delete({
      name: `opm_oidc_flow_${state}`,
      path: "/api/v1/auth/oidc/callback",
    });
  }
  return response;
}

function redirectToLogin(publicOrigin: string, error: string, state?: string | null) {
  return redirectClearingFlow(new URL(`/login?error=${error}`, publicOrigin), state);
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

  const returnedState = request.nextUrl.searchParams.get("state");
  if (!returnedState || !STATE_REGEX.test(returnedState)) {
    return redirectToLogin(publicOrigin, "oidc_session_expired", null);
  }

  const stateCookie = request.cookies.get(`opm_oidc_flow_${returnedState}`)?.value;
  if (!stateCookie) {
    return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
  }

  let codeVerifier: string;
  let expectedState: string;
  let expectedNonce: string;
  let linkMode = false;

  try {
    const { payload } = await jwtVerify(stateCookie, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: OIDC_FLOW_AUDIENCE,
    });
    if (
      typeof payload.verifier !== "string" ||
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.link !== "number" ||
      payload.state !== returnedState
    ) {
      return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
    }
    codeVerifier = payload.verifier;
    expectedState = payload.state;
    expectedNonce = payload.nonce;
    linkMode = payload.link === 1;
  } catch {
    return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
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

    const linkSession = linkMode ? await getSession() : null;
    if (linkMode && !linkSession) {
      return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
    }

    const result = await resolveOidcUser(
      {
        iss: claims.iss,
        sub: claims.sub,
        email: typeof claims.email === "string" ? claims.email : undefined,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : undefined,
      },
      { linkUserId: linkSession?.userId }
    );

    if (linkSession) {
      return redirectClearingFlow(new URL(`/?sso_link=${result.ok ? "linked" : result.error}`, publicOrigin), returnedState);
    }

    if (!result.ok) {
      return redirectToLogin(publicOrigin, `oidc_${result.error}`, returnedState);
    }

    await createSession({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      tokenVersion: result.user.tokenVersion,
    });

    return redirectClearingFlow(new URL("/", publicOrigin), returnedState);
  } catch (error) {
    console.error("OIDC callback error:", error);
    return redirectToLogin(publicOrigin, "oidc_failed", returnedState);
  }
}
