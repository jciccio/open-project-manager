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
    idTokenClaims.current = { sub: `sub-${Date.now()}`, email, email_verified: true };

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
    idTokenClaims.current = { sub, email: user.email, email_verified: true };

    const res = await callback("opm_oidc_link=1");

    expect(res.headers.get("location")).toBe("https://opm.example.com/?sso_link=linked");
    expect((await db.user.findUnique({ where: { id: user.id } }))?.oidcSubject).toBe(sub);
  });

  it("treats a link-mode callback without a session as expired", async () => {
    idTokenClaims.current = { sub: `sub-${Date.now()}`, email: "x@example.com", email_verified: true };

    const res = await callback("opm_oidc_link=1");

    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_session_expired");
  });
});
