import { describe, it, expect, afterEach } from "vitest";
import {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  updateUserProfile,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../auth";
import { createSession, verifyToken, getApiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { cleanupTestUser } from "@/test/helpers";
import { NextRequest } from "next/server";

describe("Auth Server Actions", () => {
  let createdUserId: string | null = null;
  const testEmail = `auth-action-test-${Date.now()}@example.com`;
  const testPass = "SecurePass123!";

  afterEach(async () => {
    if (createdUserId) {
      await cleanupTestUser(createdUserId);
      createdUserId = null;
    }
  });

  it("fails registration with missing or invalid fields", async () => {
    const res1 = await registerUser({ name: "", email: "", password: "" });
    expect(res1.success).toBe(false);
    expect(res1.error).toBe("All fields are required.");

    const res2 = await registerUser({
      name: "Test",
      email: testEmail,
      password: "123",
      confirmPassword: "123",
    });
    expect(res2.success).toBe(false);
    expect(res2.error).toBe("Password must be at least 6 characters long.");

    const res3 = await registerUser({
      name: "Test",
      email: testEmail,
      password: "password123",
      confirmPassword: "password456",
    });
    expect(res3.success).toBe(false);
    expect(res3.error).toBe("Passwords do not match.");
  });

  it("registers a new user successfully and logs them in", async () => {
    const regRes = await registerUser({
      name: "Auth Test User",
      email: testEmail,
      password: testPass,
      confirmPassword: testPass,
    });

    expect(regRes.success).toBe(true);
    expect(regRes.data).toBeDefined();
    if (regRes.data) {
      createdUserId = regRes.data.userId;
      expect(regRes.data.email).toBe(testEmail);
    }

    const current = await getCurrentUser();
    expect(current).not.toBeNull();
    expect(current?.email).toBe(testEmail);
  });

  it("fails registration if email already exists", async () => {
    const regRes = await registerUser({
      name: "Auth Test User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const dupRes = await registerUser({
      name: "Duplicate User",
      email: testEmail,
      password: testPass,
    });
    expect(dupRes.success).toBe(false);
    expect(dupRes.error).toBe("An account with this email already exists.");
  });

  it("handles login with correct and incorrect credentials", async () => {
    const regRes = await registerUser({
      name: "Login Test User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const wrongPassRes = await loginUser({ email: testEmail, password: "wrongpassword" });
    expect(wrongPassRes.success).toBe(false);
    expect(wrongPassRes.error).toBe("Invalid email or password.");

    const loginRes = await loginUser({ email: testEmail, password: testPass });
    expect(loginRes.success).toBe(true);
    expect(loginRes.data?.email).toBe(testEmail);
  });

  it("updates user profile name and password", async () => {
    const regRes = await registerUser({
      name: "Profile User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const updateRes = await updateUserProfile({
      name: "Updated Profile Name",
      currentPassword: testPass,
      newPassword: "NewSecurePassword123!",
    });

    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Updated Profile Name");

    const current = await getCurrentUser();
    expect(current?.name).toBe("Updated Profile Name");
  });

  it("creates, lists, and revokes a named API token", async () => {
    const regRes = await registerUser({
      name: "API Token User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const createRes = await createApiToken("Test Client");
    expect(createRes.success).toBe(true);
    expect(createRes.token?.name).toBe("Test Client");
    expect(typeof createRes.token?.secret).toBe("string");
    expect(createRes.token!.secret.length).toBeGreaterThan(20);

    const listRes = await listApiTokens();
    expect(listRes.success).toBe(true);
    expect(listRes.tokens).toHaveLength(1);
    expect(listRes.tokens?.[0].id).toBe(createRes.token!.id);
    expect(listRes.tokens?.[0].name).toBe("Test Client");

    const revokeRes = await revokeApiToken(createRes.token!.id);
    expect(revokeRes.success).toBe(true);

    const listAfterRevoke = await listApiTokens();
    expect(listAfterRevoke.tokens).toHaveLength(0);
  });

  it("never accepts an API token JWT as a session, valid or revoked", async () => {
    const regRes = await registerUser({
      name: "Cookie Confusion User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const createRes = await createApiToken("Cookie Confusion Client");
    const apiTokenSecret = createRes.token!.secret;

    // registerUser() logs the user in (sets a real session cookie via
    // next/headers). Clear it so getApiSession's cookies()-fallback branch
    // can't mask the NextRequest cookie we're actually testing below.
    await logoutUser();

    // Rejected as a session, both directly and via the getApiSession cookie
    // fallback, even while the token is still valid and unrevoked.
    expect(await verifyToken(apiTokenSecret)).toBeNull();
    const reqWithValidToken = new NextRequest("http://localhost/api/v1/cards", {
      headers: { Cookie: `opm_session=${apiTokenSecret}` },
    });
    expect(await getApiSession(reqWithValidToken)).toBeNull();

    // Still rejected once revoked (would previously stay "valid" as a cookie
    // for up to a year past revocation).
    await revokeApiToken(createRes.token!.id);
    expect(await verifyToken(apiTokenSecret)).toBeNull();
    const reqWithRevokedToken = new NextRequest("http://localhost/api/v1/cards", {
      headers: { Cookie: `opm_session=${apiTokenSecret}` },
    });
    expect(await getApiSession(reqWithRevokedToken)).toBeNull();

    // A real session JWT is unaffected.
    const sessionToken = await createSession({
      userId: regRes.data!.userId,
      email: testEmail,
      name: "Cookie Confusion User",
    });
    const sessionPayload = await verifyToken(sessionToken);
    expect(sessionPayload?.email).toBe(testEmail);
  });

  it("rejects creating an API token with an empty name", async () => {
    const regRes = await registerUser({
      name: "Empty Token Name User",
      email: testEmail,
      password: testPass,
    });
    if (regRes.data) createdUserId = regRes.data.userId;

    const res = await createApiToken("   ");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Token name is required.");
  });

  it("logs out user", async () => {
    await logoutUser();
    const current = await getCurrentUser();
    expect(current).toBeNull();
  });

  it("rejects password login for an OIDC-only user with no passwordHash", async () => {
    const oidcOnlyEmail = `oidc-only-${Date.now()}@example.com`;
    const oidcOnlyUser = await db.user.create({
      data: { email: oidcOnlyEmail, name: "OIDC Only User", oidcSubject: `sub-${Date.now()}` },
    });
    createdUserId = oidcOnlyUser.id;

    const res = await loginUser({ email: oidcOnlyEmail, password: "anything123" });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid email or password.");
  });

  it("lets an OIDC-only user set a password without a current password", async () => {
    const oidcOnlyEmail = `oidc-setpass-${Date.now()}@example.com`;
    const oidcOnlyUser = await db.user.create({
      data: { email: oidcOnlyEmail, name: "OIDC Only User", oidcSubject: `sub-${Date.now()}` },
    });
    createdUserId = oidcOnlyUser.id;

    await createSession({
      userId: oidcOnlyUser.id,
      email: oidcOnlyUser.email,
      name: oidcOnlyUser.name,
    });

    const res = await updateUserProfile({ newPassword: "BrandNewPassword123!" });
    expect(res.success).toBe(true);

    const loginRes = await loginUser({ email: oidcOnlyEmail, password: "BrandNewPassword123!" });
    expect(loginRes.success).toBe(true);
  });
});

