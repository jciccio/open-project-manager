import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { middleware } from "@/middleware";
import { JWT_SECRET } from "@/lib/env";
import { db } from "@/lib/db";
import { passwordMatches } from "@/lib/passwords";
import { getApiSession } from "@/lib/auth";
import { createApiToken } from "@/actions/auth";
import { createSession, destroySession } from "@/lib/auth";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

describe("middleware public paths", () => {
  it("treats only exact public paths and their sub-paths as public", async () => {
    const lookalikePage = await middleware(new NextRequest("http://localhost/loginanything"));
    expect(lookalikePage.headers.get("location")).toBe("http://localhost/login");

    const lookalikeApi = await middleware(new NextRequest("http://localhost/api/v1/auth/login-debug"));
    expect(lookalikeApi.status).toBe(401);

    const login = await middleware(new NextRequest("http://localhost/login"));
    expect(login.headers.get("location")).toBeNull();
  });

  it("rejects a token signed with a different HMAC algorithm", async () => {
    const hs512 = await new SignJWT({ userId: "someone", email: "x@example.com", name: "X" })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(JWT_SECRET);

    const res = await middleware(
      new NextRequest("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${hs512}` } })
    );
    expect(res.status).toBe(401);
  });
});

describe("passwordMatches", () => {
  afterEach(() => vi.restoreAllMocks());

  it("still runs bcrypt when there is no password hash", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await passwordMatches("guess", null)).toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("matches a real hash", async () => {
    const hash = await bcrypt.hash("right-password", 4);
    expect(await passwordMatches("right-password", hash)).toBe(true);
    expect(await passwordMatches("wrong-password", hash)).toBe(false);
  });
});

describe("API token lastUsedAt", () => {
  it("writes lastUsedAt at most once per interval", async () => {
    const { user } = await createTestUser(`last-used-${Date.now()}`);
    try {
      await createSession({ userId: user.id, email: user.email, name: user.name });
      const created = await createApiToken("last-used test");
      await destroySession();
      const token = created.token!.secret;
      const request = () =>
        getApiSession(new NextRequest("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } }));

      expect(await request()).not.toBeNull();
      const first = (await db.apiToken.findFirst({ where: { userId: user.id } }))!.lastUsedAt;
      expect(first).not.toBeNull();

      const update = vi.spyOn(db.apiToken, "update");
      expect(await request()).not.toBeNull();
      expect(update).not.toHaveBeenCalled();
      update.mockRestore();
    } finally {
      await cleanupTestUser(user.id);
    }
  });
});
