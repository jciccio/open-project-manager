import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { isRegistrationOpen } from "@/lib/registration";
import { registerUser } from "@/actions/auth";
import RegisterPage from "@/app/register/page";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

describe("registration gate", () => {
  const previous = process.env.OPM_ALLOW_REGISTRATION;
  let existingUserId: string;

  beforeEach(async () => {
    delete process.env.OPM_ALLOW_REGISTRATION;
    existingUserId = (await createTestUser(`reg-gate-existing-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUser(existingUserId);
    if (previous === undefined) delete process.env.OPM_ALLOW_REGISTRATION;
    else process.env.OPM_ALLOW_REGISTRATION = previous;
  });

  it("refuses registration once an account exists and creates no row", async () => {
    const email = `reg-gate-closed-${Date.now()}@example.invalid`;
    const res = await registerUser({ name: "Closed", email, password: "secret-pass-1" });

    expect(res.success).toBe(false);
    expect(res.error).toBe("Registration is closed on this instance.");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("allows registration when OPM_ALLOW_REGISTRATION=true", async () => {
    process.env.OPM_ALLOW_REGISTRATION = "true";
    const email = `reg-gate-open-${Date.now()}@example.invalid`;
    const res = await registerUser({ name: "Open", email, password: "secret-pass-1" });

    expect(res.success).toBe(true);
    await cleanupTestUser(res.data!.userId);
  });

  it("stays open for the first account", async () => {
    vi.spyOn(db.user, "count").mockResolvedValue(0);
    expect(await isRegistrationOpen()).toBe(true);
  });

  it("redirects /register to the login page when closed", async () => {
    await expect(RegisterPage()).rejects.toThrow("NEXT_REDIRECT:/login?error=registration_closed");
  });
});
