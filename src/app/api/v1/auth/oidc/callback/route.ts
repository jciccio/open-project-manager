import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { createSession, getSession } from "@/lib/auth";
import { getOidcConfig, getOidcRedirectUri, isOidcConfigured, resolveOidcUser } from "@/lib/oidc";

const OIDC_COOKIE_NAMES = ["opm_oidc_verifier", "opm_oidc_state", "opm_oidc_nonce", "opm_oidc_link"] as const;

function redirectClearingFlow(url: URL, state?: string | null) {
  const response = NextResponse.redirect(url);
  for (const name of OIDC_COOKIE_NAMES) {
    response.cookies.delete(name);
  }
  if (state) {
    response.cookies.delete(`opm_oidc_${state}`);
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
  const stateCookie = returnedState ? request.cookies.get(`opm_oidc_${returnedState}`)?.value : null;

  let codeVerifier: string | undefined;
  let expectedState: string | undefined;
  let expectedNonce: string | undefined;
  let linkMode = false;

  if (stateCookie) {
    try {
      const parsed = JSON.parse(stateCookie);
      codeVerifier = parsed.verifier;
      expectedState = parsed.state ?? returnedState ?? undefined;
      expectedNonce = parsed.nonce;
      linkMode = Boolean(parsed.link);
    } catch {
      // Fallback to legacy cookies on parse error
    }
  }

  if (!codeVerifier) {
    codeVerifier = request.cookies.get("opm_oidc_verifier")?.value;
    expectedState = request.cookies.get("opm_oidc_state")?.value;
    expectedNonce = request.cookies.get("opm_oidc_nonce")?.value;
    linkMode = request.cookies.get("opm_oidc_link")?.value === "1";
  }

  if (!codeVerifier || !expectedState || !expectedNonce) {
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

    const response = NextResponse.redirect(new URL("/", publicOrigin));
    for (const name of OIDC_COOKIE_NAMES) {
      response.cookies.delete(name);
    }
    if (returnedState) {
      response.cookies.delete(`opm_oidc_${returnedState}`);
    }
    return response;
  } catch (error) {
    console.error("OIDC callback error:", error);
    return redirectToLogin(publicOrigin, "oidc_failed", returnedState);
  }
}
