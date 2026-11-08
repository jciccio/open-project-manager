import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { createSession, getSession } from "@/lib/auth";
import {
  getOidcConfig,
  getOidcFlowCookiePath,
  getOidcRedirectUri,
  isOidcConfigured,
  OIDC_FLOW_COOKIE_PREFIX,
  OIDC_STATE_REGEX,
  readOidcFlow,
  resolveOidcUser,
} from "@/lib/oidc";

function redirectClearingFlow(url: URL, state?: string | null) {
  const response = NextResponse.redirect(url);
  if (state && OIDC_STATE_REGEX.test(state)) {
    response.cookies.delete({
      name: `${OIDC_FLOW_COOKIE_PREFIX}${state}`,
      path: getOidcFlowCookiePath(),
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

  const idpError = request.nextUrl.searchParams.get("error");
  const returnedState = request.nextUrl.searchParams.get("state");
  if (idpError) {
    console.error("OIDC IdP returned error:", idpError, request.nextUrl.searchParams.get("error_description"));
    return redirectToLogin(publicOrigin, "oidc_failed", returnedState);
  }

  if (!returnedState || !OIDC_STATE_REGEX.test(returnedState)) {
    return redirectToLogin(publicOrigin, "oidc_session_expired", null);
  }

  const stateCookie = request.cookies.get(`${OIDC_FLOW_COOKIE_PREFIX}${returnedState}`)?.value;
  const flow = await readOidcFlow(stateCookie, returnedState);
  if (!flow) {
    return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
  }

  const linkMode = flow.link === 1;

  try {
    const config = await getOidcConfig();
    const callbackUrl = new URL(getOidcRedirectUri());
    callbackUrl.search = request.nextUrl.search;
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
    });

    const claims = tokens.claims();
    if (!claims) {
      throw new Error("OIDC callback did not return ID token claims");
    }

    const linkSession = linkMode ? await getSession() : null;
    if (linkMode && !linkSession) {
      return redirectToLogin(publicOrigin, "oidc_session_expired", returnedState);
    }
    if (linkMode && flow.linkUserId && linkSession?.userId !== flow.linkUserId) {
      return redirectClearingFlow(new URL("/?sso_link=failed", publicOrigin), returnedState);
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
    if (linkMode) {
      return redirectClearingFlow(new URL("/?sso_link=failed", publicOrigin), returnedState);
    }
    return redirectToLogin(publicOrigin, "oidc_failed", returnedState);
  }
}
