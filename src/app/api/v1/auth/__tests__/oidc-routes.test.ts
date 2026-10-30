import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { cleanupTestUser } from "@/test/helpers";

const idTokenClaims = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({})),
  randomPKCECodeVerifier: () => "verifier",
  calculatePKCECodeChallenge: async () => "challenge",
  randomState: () => "state",
  randomNonce: () => "nonce",
  buildAuthorizationUrl: () => new URL("https://idp.example.com/authorize"),
  authorizationCodeGrant: vi.fn(async () => ({ claims: () => idTokenClaims.current })),
}));

import { GET as oidcLogin } from "../oidc/login/route";
import { GET as oidcCallback } from "../oidc/callback/route";

const FLOW_COOKIES = "opm_oidc_verifier=verifier; opm_oidc_state=state; opm_oidc_nonce=nonce";

function callback(extraCookies = "") {
  return oidcCallback(
    new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=abc&state=state", {
      headers: { cookie: [FLOW_COOKIES, extraCookies].filter(Boolean).join("; ") },
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
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await destroySession();
    for (const id of userIds.splice(0)) await cleanupTestUser(id);
  });

  it("refuses to start a link flow without a session", async () => {
    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    expect(res.headers.get("location")).toBe("https://opm.example.com/login");
    expect(res.cookies.get("opm_oidc_link")).toBeUndefined();
  });

  it("marks the flow as a link when a signed-in user starts it", async () => {
    const user = await db.user.create({ data: { email: `oidc-route-${Date.now()}@example.com`, name: "Linker" } });
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name });

    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login?link=1"));
    expect(res.headers.get("location")).toContain("https://idp.example.com/authorize");
    expect(res.cookies.get("opm_oidc_link")?.value).toBe("1");
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

    const res = await callback("opm_oidc_link=1");

    expect(res.headers.get("location")).toBe("https://opm.example.com/?sso_link=linked");
    expect((await db.user.findUnique({ where: { id: user.id } }))?.oidcSubject).toBe(sub);
  });

  it("treats a link-mode callback without a session as expired", async () => {
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-${Date.now()}`, email: "x@example.com", email_verified: true };

    const res = await callback("opm_oidc_link=1");

    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");
  });

  it("handles parallel OIDC logins without clobbering state/nonce cookies (#198)", async () => {
    const flow1Data = JSON.stringify({ verifier: "verifier_1", state: "state_1", nonce: "nonce_1", link: 0 });
    const flow2Data = JSON.stringify({ verifier: "verifier_2", state: "state_2", nonce: "nonce_2", link: 0 });

    const sharedCookies = [
      `opm_oidc_state_1=${encodeURIComponent(flow1Data)}`,
      `opm_oidc_state_2=${encodeURIComponent(flow2Data)}`,
      // Legacy cookies overwritten by flow 2
      "opm_oidc_verifier=verifier_2",
      "opm_oidc_state=state_2",
      "opm_oidc_nonce=nonce_2",
    ].join("; ");

    const email1 = `oidc-parallel-1-${Date.now()}@example.com`;
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-parallel-1-${Date.now()}`, email: email1, email_verified: true };

    // Tab 1 callback arrives with state_1
    const res1 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=code_1&state=state_1", {
        headers: { cookie: sharedCookies },
      })
    );

    // Tab 1 succeeds and creates session for user 1
    expect(res1.headers.get("location")).toBe("https://opm.example.com/");
    const user1 = await db.user.findUnique({ where: { email: email1 } });
    expect(user1).not.toBeNull();
    userIds.push(user1!.id);

    const email2 = `oidc-parallel-2-${Date.now()}@example.com`;
    idTokenClaims.current = { iss: "https://idp.example.com", sub: `sub-parallel-2-${Date.now()}`, email: email2, email_verified: true };

    // Tab 2 callback arrives with state_2
    const res2 = await oidcCallback(
      new NextRequest("https://opm.example.com/api/v1/auth/oidc/callback?code=code_2&state=state_2", {
        headers: { cookie: sharedCookies },
      })
    );

    // Tab 2 also succeeds
    expect(res2.headers.get("location")).toBe("https://opm.example.com/");
    const user2 = await db.user.findUnique({ where: { email: email2 } });
    expect(user2).not.toBeNull();
    userIds.push(user2!.id);
  });
});
