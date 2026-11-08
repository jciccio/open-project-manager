import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import * as oidcClient from "openid-client";
import { jwtVerify, SignJWT } from "jose";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { JWT_SECRET } from "@/lib/env";
import { OIDC_FLOW_AUDIENCE, TOKEN_ISSUER } from "@/lib/tokenClaims";
import { getOidcFlowCookiePath, signOidcFlow } from "@/lib/oidc";
import { proxy } from "@/proxy";
import { cleanupTestUser } from "@/test/helpers";

const idTokenClaims = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const verifierQueue: string[] = [];
const stateQueue: string[] = [];
const nonceQueue: string[] = [];

vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => verifierQueue.shift() ?? "verifier",
  calculatePKCECodeChallenge: async () => "challenge",
  randomState: () => stateQueue.shift() ?? "state",
  randomNonce: () => nonceQueue.shift() ?? "nonce",
  buildAuthorizationUrl: () => new URL("https://idp.example.com/authorize"),
  authorizationCodeGrant: vi.fn(async () => ({ claims: () => idTokenClaims.current })),
}));

import { GET as oidcLogin } from "../oidc/login/route";
import { GET as oidcCallback } from "../oidc/callback/route";

async function createFlowCookie(overrides: { verifier?: string; state?: string; nonce?: string; link?: number } = {}) {
  const token = await new SignJWT({
    verifier: overrides.verifier ?? "verifier",
    state: overrides.state ?? "state",
    nonce: overrides.nonce ?? "nonce",
    link: overrides.link ?? 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(OIDC_FLOW_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(JWT_SECRET);
  return `opm_oidc_flow_${overrides.state ?? "state"}=${token}`;
}

async function callback(extraCookies = "", state = "state", flowCookie?: string) {
  const flow = flowCookie !== undefined ? flowCookie : await createFlowCookie({ state });
  const cookies = [flow, extraCookies].filter(Boolean).join("; ");
  return oidcCallback(
    new NextRequest(`https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=${state}`, {
      headers: { cookie: cookies },
    })
  );
}

describe("OIDC routes", () => {
  const originalEnv = { ...process.env };
  const userIds: string[] = [];

  beforeEach(() => {
    process.env.OIDC_ISSUER_URL = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    process.env.OIDC_REDIRECT_URI = "https://opm.example.com/api/v1/auth/oidc/callback";
    verifierQueue.length = 0;
    stateQueue.length = 0;
    nonceQueue.length = 0;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await destroySession();
    for (const id of userIds.splice(0)) await cleanupTestUser(id);
  });

  it("refuses to start a link flow without a session", async () => {
    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    expect(res.headers.get("location")).toBe("https://opm.example.com/login");
    expect(res.cookies.get("opm_oidc_flow_state")).toBeUndefined();
  });

  it("marks the flow as a link when a signed-in user starts it", async () => {
    const user = await db.user.create({ data: { email: `oidc-route-${Date.now()}@example.com`, name: "Linker" } });
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name });

    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    expect(res.headers.get("location")).toContain("https://idp.example.com/authorize");
    const flowCookie = res.cookies.get("opm_oidc_flow_state");
    expect(flowCookie).toBeDefined();
    const { payload } = await jwtVerify(flowCookie!.value, JWT_SECRET, {
      issuer: TOKEN_ISSUER,
      audience: OIDC_FLOW_AUDIENCE,
    });
    expect(payload.link).toBe(1);
  });

  it("sends a sign-in for a password account's email back to login with link_required", async () => {
    const email = `oidc-route-pw-${Date.now()}@example.com`;
    const user = await db.user.create({ data: { email, name: "Password User", passwordHash: "hash" } });
    userIds.push(user.id);
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-${Date.now()}`, email, email_verified: true };

    const res = await callback();

    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_link_required");
    expect((await db.user.findUnique({ where: { id: user.id } }))?.oidcSubject).toBeNull();
  });

  it("links the signed-in user in link mode and reports it on the dashboard", async () => {
    const user = await db.user.create({
      data: { email: `oidc-route-link-${Date.now()}@example.com`, name: "Password User", passwordHash: "hash" },
    });
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name });
    const sub = `sub-link-${Date.now()}`;
    idTokenClaims.current = { iss: "https://idp.example.com", sub, email: user.email, email_verified: true };

    const flowCookie = await createFlowCookie({ link: 1 });
    const res = await callback("", "state", flowCookie);

    expect(res.headers.get("location")).toBe("https://opm.example.com/?sso_link=linked");
    expect((await db.user.findUnique({ where: { id: user.id } }))?.oidcSubject).toBe(sub);
  });

  it("treats a link-mode callback without a session as expired", async () => {
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-${Date.now()}`, email: "x@example.com", email_verified: true };

    const flowCookie = await createFlowCookie({ link: 1 });
    const res = await callback("", "state", flowCookie);

    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");
  });

  it("scopes the flow cookie to the OIDC auth path", async () => {
    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login"));
    const flowCookie = res.cookies.get("opm_oidc_flow_state");
    expect(flowCookie).toBeDefined();
    expect(flowCookie?.path).toBe(getOidcFlowCookiePath());
  });

  it("ensures the flow JWT from login cannot authenticate against proxy/middleware", async () => {
    const loginRes = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login"));
    const flowCookie = loginRes.cookies.get("opm_oidc_flow_state");
    expect(flowCookie).toBeDefined();
    const flowJwt = flowCookie!.value;

    // Test proxy with Bearer token
    const reqWithBearer = new NextRequest("https://opm.example.com/api/v1/projects", {
      headers: { authorization: `Bearer ${flowJwt}` },
    });
    const proxyRes1 = await proxy(reqWithBearer);
    expect(proxyRes1.status).toBe(401);

    // Test proxy with opm_session cookie
    const reqWithCookie = new NextRequest("https://opm.example.com/api/v1/projects", {
      headers: { cookie: `opm_session=${flowJwt}` },
    });
    const proxyRes2 = await proxy(reqWithCookie);
    expect(proxyRes2.status).toBe(401);

    // Test page route redirects to login, not allowed through
    const reqPage = new NextRequest("https://opm.example.com/", {
      headers: { cookie: `opm_session=${flowJwt}` },
    });
    const proxyRes3 = await proxy(reqPage);
    expect(proxyRes3.status).toBe(307);
    expect(proxyRes3.headers.get("location")).toContain("/login");
  });

  it("rejects forged, tampered, or missing flow cookies without falling back to legacy cookies", async () => {
    // Forged JWT signed with wrong secret
    const forgedToken = await new SignJWT({ verifier: "v", state: "state", nonce: "n", link: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(OIDC_FLOW_AUDIENCE)
      .sign(new TextEncoder().encode("wrong-secret-that-is-at-least-32-chars-long!"));

    const resForged = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
        headers: {
          cookie: [
            `opm_oidc_flow_state=${forgedToken}`,
            "opm_oidc_verifier=v",
            "opm_oidc_state=state",
            "opm_oidc_nonce=n",
          ].join("; "),
        },
      })
    );
    expect(resForged.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");

    // Tampered token (signature modified)
    const validFlow = await signOidcFlow({ verifier: "v", state: "state", nonce: "n", link: 0 });
    const tampered = validFlow.slice(0, -5) + "abcde";
    const resTampered = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
        headers: { cookie: `opm_oidc_flow_state=${tampered}` },
      })
    );
    expect(resTampered.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");

    // Flow token with wrong audience
    const wrongAudience = await new SignJWT({ verifier: "v", state: "state", nonce: "n", link: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TOKEN_ISSUER)
      .setAudience("wrong-audience")
      .sign(JWT_SECRET);
    const resWrongAud = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
        headers: { cookie: `opm_oidc_flow_state=${wrongAudience}` },
      })
    );
    expect(resWrongAud.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");

    // Flow token where payload.state differs from cookie name
    const stateMismatch = await signOidcFlow({ verifier: "v", state: "different-state", nonce: "n", link: 0 });
    const resMismatch = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
        headers: { cookie: `opm_oidc_flow_state=${stateMismatch}` },
      })
    );
    expect(resMismatch.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");

    // Missing flow cookie with legacy cookies present
    const resLegacyOnly = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
        headers: {
          cookie: "opm_oidc_verifier=v; opm_oidc_state=state; opm_oidc_nonce=n; opm_oidc_link=1",
        },
      })
    );
    expect(resLegacyOnly.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");
  });

  it("rejects malformed or injected state parameter without throwing 500", async () => {
    // CRLF injection attempt
    const res1 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=bad%0d%0aX:1")
    );
    expect(res1.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");

    // Cookie attribute injection attempt
    const res2 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=X=%7B%22verifier%22%3A%22v%22%7D%3B%20Path%3D%2F")
    );
    expect(res2.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");
  });

  it("handles parallel OIDC logins without clobbering state/nonce cookies (#198)", async () => {
    // Queue distinct values for tab 1 and tab 2
    verifierQueue.push("verifier_1", "verifier_2");
    stateQueue.push("state_1", "state_2");
    nonceQueue.push("nonce_1", "nonce_2");

    // User for link mode on tab 1
    const linkUser = await db.user.create({ data: { email: `oidc-link-user-${Date.now()}@example.com`, name: "Link User" } });
    userIds.push(linkUser.id);
    await createSession({ userId: linkUser.id, email: linkUser.email, name: linkUser.name });

    // Tab 1 login (link mode = 1)
    const loginRes1 = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    const cookie1 = loginRes1.cookies.get("opm_oidc_flow_state_1");
    expect(cookie1).toBeDefined();
    expect(cookie1?.path).toBe(getOidcFlowCookiePath());

    // Destroy session so Tab 2 is an anonymous login
    await destroySession();

    // Tab 2 login (standard login mode)
    const loginRes2 = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login"));
    const cookie2 = loginRes2.cookies.get("opm_oidc_flow_state_2");
    expect(cookie2).toBeDefined();
    expect(cookie2?.path).toBe(getOidcFlowCookiePath());

    // Replay both Set-Cookie headers into a shared cookie header
    const sharedCookies = [
      `opm_oidc_flow_state_1=${cookie1!.value}`,
      `opm_oidc_flow_state_2=${cookie2!.value}`,
    ].join("; ");

    // Restore session for tab 1's link callback
    await createSession({ userId: linkUser.id, email: linkUser.email, name: linkUser.name });
    const sub1 = `sub-parallel-1-${Date.now()}`;
    idTokenClaims.current = { iss: "https://idp.example.com", sub: sub1, email: linkUser.email, email_verified: true };

    // Tab 1 callback arrives with state_1
    const res1 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=code_1&state=state_1", {
        headers: { cookie: sharedCookies },
      })
    );

    expect(vi.mocked(oidcClient.authorizationCodeGrant)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { pkceCodeVerifier: "verifier_1", expectedState: "state_1", expectedNonce: "nonce_1" },
    );
    expect(res1.headers.get("location")).toBe("https://opm.example.com/?sso_link=linked");
    // Verify it deleted tab 1's flow cookie with proper path
    const del1 = res1.cookies.get("opm_oidc_flow_state_1");
    expect(del1).toBeDefined();
    expect(del1?.value).toBe("");
    expect(del1?.path).toBe(getOidcFlowCookiePath());
    // Tab 2's cookie should NOT be cleared by Tab 1's callback
    expect(res1.cookies.get("opm_oidc_flow_state_2")).toBeUndefined();

    // Now Tab 2 callback arrives with state_2
    await destroySession();
    const email2 = `oidc-parallel-2-${Date.now()}@example.com`;
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-parallel-2-${Date.now()}`, email: email2, email_verified: true };

    const res2 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=code_2&state=state_2", {
        headers: { cookie: sharedCookies },
      })
    );

    expect(vi.mocked(oidcClient.authorizationCodeGrant)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { pkceCodeVerifier: "verifier_2", expectedState: "state_2", expectedNonce: "nonce_2" },
    );
    expect(res2.headers.get("location")).toBe("https://opm.example.com/");
    const del2 = res2.cookies.get("opm_oidc_flow_state_2");
    expect(del2).toBeDefined();
    expect(del2?.value).toBe("");
    expect(del2?.path).toBe(getOidcFlowCookiePath());

    const user2 = await db.user.findUnique({ where: { email: email2 } });
    expect(user2).not.toBeNull();
    userIds.push(user2!.id);
  });

  it("rejects link mode when session user does not match the user who initiated the flow", async () => {
    const userA = await db.user.create({ data: { email: `user-a-${Date.now()}@example.com`, name: "User A" } });
    const userB = await db.user.create({ data: { email: `user-b-${Date.now()}@example.com`, name: "User B" } });
    userIds.push(userA.id, userB.id);

    // User A signs in and initiates link
    await createSession({ userId: userA.id, email: userA.email, name: userA.name });
    verifierQueue.push("verifier_link");
    stateQueue.push("state_link");
    nonceQueue.push("nonce_link");

    const loginRes = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    const cookie = loginRes.cookies.get("opm_oidc_flow_state_link")!;

    // Now User B has the session at callback time
    await createSession({ userId: userB.id, email: userB.email, name: userB.name });
    idTokenClaims.current = { iss: "https://idp.example.com", sub: "sub-user-a", email: userA.email, email_verified: true };

    const callbackRes = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=linkcode&state=state_link", {
        headers: { cookie: `opm_oidc_flow_state_link=${cookie.value}` },
      })
    );

    // Should redirect to sso_link=failed and NOT link A's IdP to B!
    expect(callbackRes.headers.get("location")).toBe("https://opm.example.com/?sso_link=failed");
    const freshUserB = await db.user.findUnique({ where: { id: userB.id } });
    expect(freshUserB?.oidcSubject).toBeNull();
  });

  it("redirects to oidc_failed and logs when IdP returns an error without state", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?error=access_denied&error_description=User+cancelled")
    );
    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_failed");
    expect(errorSpy).toHaveBeenCalledWith("OIDC IdP returned error:", "access_denied", "User cancelled");
  });

  it("prunes older flow cookies on login when 5 or more exist", async () => {
    verifierQueue.push("v_new");
    stateQueue.push("s_new");
    nonceQueue.push("n_new");

    const existingCookies = [
      "opm_oidc_flow_1=val1",
      "opm_oidc_flow_2=val2",
      "opm_oidc_flow_3=val3",
      "opm_oidc_flow_4=val4",
      "opm_oidc_flow_5=val5",
    ].join("; ");

    const res = await oidcLogin(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/login", {
        headers: { cookie: existingCookies },
      })
    );

    // Should delete the oldest flow cookie (opm_oidc_flow_1)
    const del = res.cookies.get("opm_oidc_flow_1");
    expect(del).toBeDefined();
    expect(del?.value).toBe("");
    expect(del?.path).toBe(getOidcFlowCookiePath());
  });
});
