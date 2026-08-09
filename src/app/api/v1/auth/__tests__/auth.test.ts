import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "../login/route";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

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
});
