import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, decodeJwt } from "jose";
import { middleware } from "@/middleware";
import { JWT_SECRET } from "@/lib/env";
import { getApiSession, signApiToken, signToken, verifyToken } from "@/lib/auth";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

function tokenWith(claims: { iss?: string; aud?: string }, userId: string) {
  let jwt = new SignJWT({ userId, email: "x@example.com", name: "X" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h");
  if (claims.iss) jwt = jwt.setIssuer(claims.iss);
  if (claims.aud) jwt = jwt.setAudience(claims.aud);
  return jwt.sign(JWT_SECRET);
}

const bearer = (token: string) =>
  new NextRequest("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });

describe("JWT issuer and audience", () => {
  let userId: string;
  let email: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`claims-${Date.now()}`);
    userId = user.id;
    email = user.email;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("stamps session and API tokens with the issuer and their own audience", async () => {
    const session = decodeJwt(await signToken({ userId, email, name: "X" }));
    const api = decodeJwt(await signApiToken({ userId, email, name: "X" }, "token-id"));

    expect(session).toMatchObject({ iss: "open-project-manager", aud: "opm:session" });
    expect(api).toMatchObject({ iss: "open-project-manager", aud: "opm:api" });
  });

  it("issues a session-audience token from the password login route", async () => {
    const res = await loginRoute(
      new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "TestPass123!" }),
      })
    );
    const { token } = await res.json();

    expect(decodeJwt(token)).toMatchObject({ iss: "open-project-manager", aud: "opm:session" });
  });

  it("does not accept an API-audience token as a session", async () => {
    expect(await verifyToken(await tokenWith({ iss: "open-project-manager", aud: "opm:api" }, userId))).toBeNull();
  });

  it("rejects a token issued for another audience or by another issuer everywhere", async () => {
    for (const claims of [
      { iss: "open-project-manager", aud: "other-app" },
      { iss: "other-app", aud: "opm:session" },
    ]) {
      const token = await tokenWith(claims, userId);
      expect(await verifyToken(token)).toBeNull();
      expect(await getApiSession(bearer(token))).toBeNull();
      expect((await middleware(bearer(token))).status).toBe(401);
    }
  });

  it("still accepts a token signed before iss and aud existed", async () => {
    const legacy = await tokenWith({}, userId);

    expect(await verifyToken(legacy)).not.toBeNull();
    expect(await getApiSession(bearer(legacy))).not.toBeNull();
    expect((await middleware(bearer(legacy))).status).toBe(200);
  });
});
