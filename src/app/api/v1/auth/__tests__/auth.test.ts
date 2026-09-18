import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "../login/route";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";
import { resetLoginRateLimit } from "@/lib/loginRateLimit";

describe("REST API: /api/v1/auth/login", () => {
  let userId: string;
  let userEmail: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`api-auth-${Date.now()}`);
    userId = user.id;
    userEmail = user.email;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 400 if email or password is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Email and password are required");
  });

  it("returns 401 for invalid credentials", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: "wrong-password" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid email or password");
  });

  it("returns 200 with JWT token for valid credentials", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: "TestPass123!" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(userEmail);
  });

  it("returns 401 for an OIDC-only user with no passwordHash", async () => {
    const oidcOnlyEmail = `oidc-only-rest-${Date.now()}@example.com`;
    const oidcOnlyUser = await db.user.create({
      data: { email: oidcOnlyEmail, name: "OIDC Only User", oidcSubject: `sub-${Date.now()}` },
    });

    try {
      const req = new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: oidcOnlyEmail, password: "anything123" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid email or password");
    } finally {
      await cleanupTestUser(oidcOnlyUser.id);
    }
  });

  it("returns 400 without crashing when email is not a string", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: { injected: true }, password: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Email and password are required");
  });

  it("locks out after repeated failed attempts against the same email, and returns Retry-After", async () => {
    resetLoginRateLimit();
    try {
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: userEmail, password: "wrong-password" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(401);
      }

      const lockedReq = new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: userEmail, password: "TestPass123!" }),
      });
      const lockedRes = await POST(lockedReq);
      expect(lockedRes.status).toBe(429);
      expect(lockedRes.headers.get("Retry-After")).toBeTruthy();
    } finally {
      resetLoginRateLimit();
    }
  });

  it("does not lock out a shared bucket when no x-forwarded-for header is present", async () => {
    resetLoginRateLimit();
    try {
      // One more than the per-IP threshold (25): if a missing header ever
      // fell back to a shared bucket, this would trip it and lock everyone out.
      for (let i = 0; i < 26; i++) {
        const req = new NextRequest("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `unrelated-${i}-${Date.now()}@example.com`, password: "wrong" }),
        });
        await POST(req);
      }

      const req = new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: userEmail, password: "TestPass123!" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    } finally {
      resetLoginRateLimit();
    }
  });
});
