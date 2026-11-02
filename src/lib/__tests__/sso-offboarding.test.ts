import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { JWT_SECRET } from "@/lib/env";
import { SESSION_AUDIENCE, TOKEN_ISSUER } from "@/lib/tokenClaims";
import { db } from "@/lib/db";
import { createSession, getApiSession, getSession, signToken } from "@/lib/auth";
import { createApiToken, getSsoStatus, loginUser, updateUserProfile } from "@/actions/auth";
import { POST as restLogin } from "@/app/api/v1/auth/login/route";
import { revokeUserAccess } from "@/lib/revokeUser";
import { resetLoginRateLimit } from "@/lib/loginRateLimit";
import { cleanupTestUser, createTestUser } from "@/test/helpers";

const PASSWORD = "LinkedPass123!";

async function createLinkedUser(suffix: string) {
  return db.user.create({
    data: {
      email: `sso-linked-${suffix}-${Date.now()}@example.com`,
      name: "SSO Linked",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      oidcIssuer: "https://idp.example.com",
      oidcSubject: `sub-${suffix}-${Date.now()}`,
    },
  });
}

function restLoginRequest(email: string, password: string) {
  return new NextRequest("http://localhost/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
  });
}

function bearer(token: string) {
  return new NextRequest("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });
}

const previousAllowLocal = process.env.OIDC_ALLOW_LOCAL_PASSWORD;
let userIds: string[] = [];

beforeEach(() => {
  delete process.env.OIDC_ALLOW_LOCAL_PASSWORD;
  resetLoginRateLimit();
});

afterEach(async () => {
  if (previousAllowLocal === undefined) delete process.env.OIDC_ALLOW_LOCAL_PASSWORD;
  else process.env.OIDC_ALLOW_LOCAL_PASSWORD = previousAllowLocal;
  for (const id of userIds) await cleanupTestUser(id);
  userIds = [];
});

describe("SSO-linked accounts are SSO-only", () => {
  it("refuses password login through the server action, even with the right password", async () => {
    const user = await createLinkedUser("action");
    userIds.push(user.id);

    const res = await loginUser({ email: user.email, password: PASSWORD });
    expect(res).toEqual({ success: false, error: "Invalid email or password." });
  });

  it("refuses password login through the REST route with the generic 401", async () => {
    const user = await createLinkedUser("rest");
    userIds.push(user.id);

    const res = await restLogin(restLoginRequest(user.email, PASSWORD));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
  });

  it("allows password login on both paths when OIDC_ALLOW_LOCAL_PASSWORD is true", async () => {
    process.env.OIDC_ALLOW_LOCAL_PASSWORD = "true";
    const user = await createLinkedUser("allowed");
    userIds.push(user.id);

    expect((await loginUser({ email: user.email, password: PASSWORD })).success).toBe(true);
    expect((await restLogin(restLoginRequest(user.email, PASSWORD))).status).toBe(200);
  });

  it("refuses to set a local password on an SSO-linked account", async () => {
    const user = await db.user.create({
      data: { email: `sso-setpass-${Date.now()}@example.com`, name: "SSO Only", oidcSubject: `sub-setpass-${Date.now()}` },
    });
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name });

    const res = await updateUserProfile({ newPassword: "BrandNewPassword123!" });
    expect(res).toEqual({
      success: false,
      error: "This account signs in through SSO, so it cannot have a local password.",
    });
    expect((await db.user.findUnique({ where: { id: user.id } }))!.passwordHash).toBeNull();
  });

  it("reports the SSO-only state to the profile modal", async () => {
    const user = await createLinkedUser("status");
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name });

    expect(await getSsoStatus()).toMatchObject({ linked: true, localPasswordAllowed: false, linkingDisablesPassword: true });

    process.env.OIDC_ALLOW_LOCAL_PASSWORD = "true";
    expect(await getSsoStatus()).toMatchObject({ linked: true, localPasswordAllowed: true, linkingDisablesPassword: false });
  });
});

describe("tokenVersion", () => {
  it("accepts a token issued before tokenVersion existed while the user is at version 0", async () => {
    const { user } = await createTestUser(`tv-legacy-${Date.now()}`);
    userIds.push(user.id);
    const legacyToken = await new SignJWT({ userId: user.id, email: user.email, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(JWT_SECRET);

    expect(await getApiSession(bearer(legacyToken))).toMatchObject({ userId: user.id, tokenVersion: 0 });
  });

  it("rejects cookie sessions, Bearer sessions and API tokens once the version moves on", async () => {
    const { user } = await createTestUser(`tv-bump-${Date.now()}`);
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name, tokenVersion: 0 });
    const apiToken = (await createApiToken("tv test")).token!.secret;
    const bearerSession = await signToken({ userId: user.id, email: user.email, name: user.name, tokenVersion: 0 }, 3600);

    expect(await getSession()).toMatchObject({ userId: user.id });
    expect(await getApiSession(bearer(apiToken))).toMatchObject({ userId: user.id });
    expect(await getApiSession(bearer(bearerSession))).toMatchObject({ userId: user.id });

    await db.user.update({ where: { id: user.id }, data: { tokenVersion: 1 } });

    expect(await getApiSession(bearer(apiToken))).toBeNull();
    expect(await getApiSession(bearer(bearerSession))).toBeNull();
    expect(await getSession()).toBeNull();
  });

  it("carries the current version into sessions issued after a bump", async () => {
    const user = await createLinkedUser("tv-carry");
    userIds.push(user.id);
    process.env.OIDC_ALLOW_LOCAL_PASSWORD = "true";
    await db.user.update({ where: { id: user.id }, data: { tokenVersion: 3 } });

    const res = await restLogin(restLoginRequest(user.email, PASSWORD));
    const { token } = await res.json();
    expect(await getApiSession(bearer(token))).toMatchObject({ userId: user.id, tokenVersion: 3 });
  });
});

describe("revokeUserAccess", () => {
  it("ends every session and API token and deletes the token rows", async () => {
    const { user } = await createTestUser(`revoke-${Date.now()}`);
    userIds.push(user.id);
    await createSession({ userId: user.id, email: user.email, name: user.name, tokenVersion: 0 });
    const apiToken = (await createApiToken("revoke test")).token!.secret;

    const result = await revokeUserAccess(user.email.toUpperCase());

    expect(result).toEqual({ email: user.email, tokenVersion: 1, deletedApiTokens: 1 });
    expect(await db.apiToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await getApiSession(bearer(apiToken))).toBeNull();
    expect(await getSession()).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(await revokeUserAccess("nobody-here@example.com")).toBeNull();
  });
});
