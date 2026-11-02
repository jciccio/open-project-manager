import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { decodeJwt } from "jose";
import { NextRequest } from "next/server";
import { createApiToken } from "../auth";
import { createSession, destroySession, getApiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

const bearer = (token: string) =>
  new NextRequest("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });

describe("API Token Expiration", () => {
  let userId: string;
  let email: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`token-exp-${Date.now()}`);
    userId = user.id;
    email = user.email;
    await createSession({ userId, email, name: user.name });
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("sets expiresAt and JWT exp when expiresInDays is provided as a number", async () => {
    const before = Date.now();
    const res = await createApiToken("30 Day Token", 30);
    expect(res.success).toBe(true);
    expect(res.token).toBeDefined();

    const tokenRecord = await db.apiToken.findUnique({ where: { id: res.token!.id } });
    expect(tokenRecord?.expiresAt).not.toBeNull();

    const expiresTime = tokenRecord!.expiresAt!.getTime();
    const expectedTime = before + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresTime - expectedTime)).toBeLessThan(5000);

    const payload = decodeJwt(res.token!.secret);
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBe(Math.floor(expiresTime / 1000));

    await destroySession();
    const session = await getApiSession(bearer(res.token!.secret));
    expect(session?.userId).toBe(userId);
  });

  it("handles expiresInDays as string number", async () => {
    const before = Date.now();
    const res = await createApiToken("90 Day Token", "90");
    expect(res.success).toBe(true);

    const tokenRecord = await db.apiToken.findUnique({ where: { id: res.token!.id } });
    expect(tokenRecord?.expiresAt).not.toBeNull();
    const expectedTime = before + 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(tokenRecord!.expiresAt!.getTime() - expectedTime)).toBeLessThan(5000);

    await destroySession();
    const session = await getApiSession(bearer(res.token!.secret));
    expect(session?.userId).toBe(userId);
  });

  it("creates a token that never expires when expiresInDays is 'never'", async () => {
    const res = await createApiToken("Never Expiring", "never");
    expect(res.success).toBe(true);

    const tokenRecord = await db.apiToken.findUnique({ where: { id: res.token!.id } });
    expect(tokenRecord?.expiresAt).toBeNull();

    const payload = decodeJwt(res.token!.secret);
    expect(payload.exp).toBeUndefined();

    await destroySession();
    const session = await getApiSession(bearer(res.token!.secret));
    expect(session?.userId).toBe(userId);
  });

  it("defaults to 365 days when expiresInDays is omitted or undefined", async () => {
    const before = Date.now();
    const res = await createApiToken("Default Expiration Token");
    expect(res.success).toBe(true);
    expect(res.token).toBeDefined();

    const tokenRecord = await db.apiToken.findUnique({ where: { id: res.token!.id } });
    expect(tokenRecord?.expiresAt).not.toBeNull();

    const expiresTime = tokenRecord!.expiresAt!.getTime();
    const expectedTime = before + 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresTime - expectedTime)).toBeLessThan(5000);

    const payload = decodeJwt(res.token!.secret);
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBe(Math.floor(expiresTime / 1000));

    await destroySession();
    const session = await getApiSession(bearer(res.token!.secret));
    expect(session?.userId).toBe(userId);
  });

  it("rejects invalid expiresInDays options", async () => {
    for (const invalid of [0, -5, "abc", 45, 1000, ""]) {
      const res = await createApiToken("Invalid Option", invalid as any);
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid token expiration option.");
    }
  });

  it("rejects token when expiresAt in the DB is in the past", async () => {
    const res = await createApiToken("Expired DB Token", 30);
    expect(res.success).toBe(true);

    await db.apiToken.update({
      where: { id: res.token!.id },
      data: { expiresAt: new Date(Date.now() - 60000) },
    });

    await destroySession();
    const session = await getApiSession(bearer(res.token!.secret));
    expect(session).toBeNull();
  });
});
