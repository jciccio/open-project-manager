import { describe, it, expect, afterEach } from "vitest";
import { isOidcConfigured, resolveOidcUser } from "../oidc";
import { db } from "../db";
import { cleanupTestUser } from "@/test/helpers";

describe("isOidcConfigured()", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false unless every OIDC env var is set", () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    expect(isOidcConfigured()).toBe(false);

    process.env.OIDC_ISSUER_URL = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    expect(isOidcConfigured()).toBe(false);
  });

  it("is true once all four OIDC env vars are set", () => {
    process.env.OIDC_ISSUER_URL = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    process.env.OIDC_REDIRECT_URI = "https://opm.example.com/api/v1/auth/oidc/callback";
    expect(isOidcConfigured()).toBe(true);
  });
});

describe("resolveOidcUser()", () => {
  let createdUserId: string | null = null;

  afterEach(async () => {
    if (createdUserId) {
      await cleanupTestUser(createdUserId);
      createdUserId = null;
    }
  });

  it("creates a new user on first login from a new subject", async () => {
    const sub = `sub-${Date.now()}`;
    const email = `oidc-new-${Date.now()}@example.com`;

    const result = await resolveOidcUser({ sub, email, emailVerified: true, name: "New OIDC User" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      createdUserId = result.user.id;
      expect(result.user.email).toBe(email);
      expect(result.user.oidcSubject).toBe(sub);
      expect(result.user.passwordHash).toBeNull();
    }
  });

  it("returns the same user on a repeat login by subject", async () => {
    const sub = `sub-${Date.now()}`;
    const email = `oidc-repeat-${Date.now()}@example.com`;

    const first = await resolveOidcUser({ sub, email, emailVerified: true, name: "Repeat User" });
    expect(first.ok).toBe(true);
    if (first.ok) createdUserId = first.user.id;

    const second = await resolveOidcUser({ sub, email, emailVerified: true, name: "Repeat User" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.user.id).toBe(createdUserId);
  });

  it("never auto-links a new subject to an account that has a local password", async () => {
    const email = `oidc-link-${Date.now()}@example.com`;
    const existing = await db.user.create({
      data: { email, name: "Existing Password User", passwordHash: "irrelevant-hash" },
    });
    createdUserId = existing.id;

    const result = await resolveOidcUser({
      sub: `sub-${Date.now()}`,
      email,
      emailVerified: true,
      name: "Existing Password User",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("link_required");
    const unchanged = await db.user.findUnique({ where: { id: existing.id } });
    expect(unchanged?.oidcSubject).toBeNull();
  });

  it("links a verified email to a passwordless account that was never linked", async () => {
    const email = `oidc-passwordless-${Date.now()}@example.com`;
    const existing = await db.user.create({ data: { email, name: "Passwordless" } });
    createdUserId = existing.id;
    const sub = `sub-${Date.now()}`;

    const result = await resolveOidcUser({ sub, email, emailVerified: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(existing.id);
      expect(result.user.oidcSubject).toBe(sub);
    }
  });

  it("does not re-point an account already linked to a different subject", async () => {
    const email = `oidc-relink-${Date.now()}@example.com`;
    const existing = await db.user.create({ data: { email, name: "Linked", oidcSubject: `original-${Date.now()}` } });
    createdUserId = existing.id;

    const result = await resolveOidcUser({ sub: `other-${Date.now()}`, email, emailVerified: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("linked_elsewhere");
    const unchanged = await db.user.findUnique({ where: { id: existing.id } });
    expect(unchanged?.oidcSubject).toBe(existing.oidcSubject);
  });

  it("does not provision a new account for an unverified email", async () => {
    const email = `oidc-unverified-new-${Date.now()}@example.com`;

    const result = await resolveOidcUser({ sub: `sub-${Date.now()}`, email, emailVerified: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_not_verified");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  describe("link mode (a signed-in user connecting SSO from their profile)", () => {
    const extraUserIds: string[] = [];

    afterEach(async () => {
      for (const id of extraUserIds.splice(0)) await cleanupTestUser(id);
    });

    it("links the subject to the signed-in account, even one with a password", async () => {
      const existing = await db.user.create({
        data: { email: `oidc-linkmode-${Date.now()}@example.com`, name: "Owner", passwordHash: "irrelevant-hash" },
      });
      createdUserId = existing.id;
      const sub = `sub-${Date.now()}`;

      const result = await resolveOidcUser(
        { sub, email: "someone-else@example.com", emailVerified: false },
        { linkUserId: existing.id }
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.user.oidcSubject).toBe(sub);
      const again = await resolveOidcUser({ sub, emailVerified: false }, { linkUserId: existing.id });
      expect(again.ok).toBe(true);
    });

    it("refuses a subject that already belongs to another user", async () => {
      const sub = `sub-taken-${Date.now()}`;
      const owner = await db.user.create({ data: { email: `oidc-owner-${Date.now()}@example.com`, name: "Owner", oidcSubject: sub } });
      const other = await db.user.create({ data: { email: `oidc-other-${Date.now()}@example.com`, name: "Other" } });
      extraUserIds.push(owner.id, other.id);

      const result = await resolveOidcUser({ sub, emailVerified: true }, { linkUserId: other.id });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("subject_in_use");
    });

    it("refuses when the signed-in account is already linked to another subject", async () => {
      const linked = await db.user.create({
        data: { email: `oidc-already-${Date.now()}@example.com`, name: "Linked", oidcSubject: `first-${Date.now()}` },
      });
      extraUserIds.push(linked.id);

      const result = await resolveOidcUser({ sub: `second-${Date.now()}`, emailVerified: true }, { linkUserId: linked.id });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("linked_elsewhere");
    });
  });

  it("refuses to link to an existing account when the IdP has not verified the email", async () => {
    const email = `oidc-unverified-${Date.now()}@example.com`;
    const existing = await db.user.create({
      data: { email, name: "Existing Password User", passwordHash: "irrelevant-hash" },
    });
    createdUserId = existing.id;

    const result = await resolveOidcUser({
      sub: `sub-${Date.now()}`,
      email,
      emailVerified: false,
      name: "Existing Password User",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_not_verified");

    const unchanged = await db.user.findUnique({ where: { id: existing.id } });
    expect(unchanged?.oidcSubject).toBeNull();
  });

  it("returns missing_email when the IdP provides no email for a new subject", async () => {
    const result = await resolveOidcUser({ sub: `sub-${Date.now()}`, emailVerified: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_email");
  });
});
