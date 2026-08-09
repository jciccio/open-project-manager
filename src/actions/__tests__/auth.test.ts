import { describe, it, expect, afterEach } from "vitest";
import { registerUser, loginUser, logoutUser, getCurrentUser, updateUserProfile } from "../auth";
import { cleanupTestUser } from "@/test/helpers";

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

  it("logs out user", async () => {
    await logoutUser();
    const current = await getCurrentUser();
    expect(current).toBeNull();
  });
});

