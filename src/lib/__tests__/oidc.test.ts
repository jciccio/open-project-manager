import { describe, it, expect, afterEach } from "vitest";
import { isOidcConfigured, resolveOidcUser } from "../oidc";
import { db } from "../db";
import { cleanupTestUser } from "@/test/helpers";

const ISS = "https://idp.example.com";

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

    const result = await resolveOidcUser({ iss: ISS, sub, email, emailVerified: true, name: "New OIDC User" });

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

    const first = await resolveOidcUser({ iss: ISS, sub, email, emailVerified: true, name: "Repeat User" });
    expect(first.ok).toBe(true);
    if (first.ok) createdUserId = first.user.id;

    const second = await resolveOidcUser({ iss: ISS, sub, email, emailVerified: true, name: "Repeat User" });
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
      iss: ISS,
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

    const result = await resolveOidcUser({ iss: ISS, sub, email, emailVerified: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(existing.id);
      expect(result.user.oidcSubject).toBe(sub);
    }
  });

  it("does not re-point an account already linked to a different subject", async () => {
    const email = `oidc-relink-${Date.now()}@example.com`;
    const existing = await db.user.create({ data: { email, name: "Linked", oidcIssuer: ISS, oidcSubject: `original-${Date.now()}` } });
    createdUserId = existing.id;

    const result = await resolveOidcUser({ iss: ISS, sub: `other-${Date.now()}`, email, emailVerified: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("linked_elsewhere");
    const unchanged = await db.user.findUnique({ where: { id: existing.id } });
    expect(unchanged?.oidcSubject).toBe(existing.oidcSubject);
  });

  it("does not provision a new account for an unverified email", async () => {
    const email = `oidc-unverified-new-${Date.now()}@example.com`;

    const result = await resolveOidcUser({ iss: ISS, sub: `sub-${Date.now()}`, email, emailVerified: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_not_verified");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it("provisions an unverified email when OIDC_TRUST_UNVERIFIED_EMAIL=true", async () => {
    const previous = process.env.OIDC_TRUST_UNVERIFIED_EMAIL;
    process.env.OIDC_TRUST_UNVERIFIED_EMAIL = "true";
    try {
      const email = `oidc-trusted-${Date.now()}@example.com`;
      const result = await resolveOidcUser({ iss: ISS, sub: `sub-${Date.now()}`, email, emailVerified: false });
      expect(result.ok).toBe(true);
      if (result.ok) createdUserId = result.user.id;
    } finally {
      if (previous === undefined) delete process.env.OIDC_TRUST_UNVERIFIED_EMAIL;
      else process.env.OIDC_TRUST_UNVERIFIED_EMAIL = previous;
    }
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
        { iss: ISS, sub, email: "someone-else@example.com", emailVerified: false },
        { linkUserId: existing.id }
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.user.oidcSubject).toBe(sub);
      const again = await resolveOidcUser({ iss: ISS, sub, emailVerified: false }, { linkUserId: existing.id });
      expect(again.ok).toBe(true);
    });

    it("refuses a subject that already belongs to another user", async () => {
      const sub = `sub-taken-${Date.now()}`;
      const owner = await db.user.create({ data: { email: `oidc-owner-${Date.now()}@example.com`, name: "Owner", oidcIssuer: ISS, oidcSubject: sub } });
      const other = await db.user.create({ data: { email: `oidc-other-${Date.now()}@example.com`, name: "Other" } });
      extraUserIds.push(owner.id, other.id);

      const result = await resolveOidcUser({ iss: ISS, sub, emailVerified: true }, { linkUserId: other.id });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("subject_in_use");
    });

    it("refuses when the signed-in account is already linked to another subject", async () => {
      const linked = await db.user.create({
        data: { email: `oidc-already-${Date.now()}@example.com`, name: "Linked", oidcIssuer: ISS, oidcSubject: `first-${Date.now()}` },
      });
      extraUserIds.push(linked.id);

      const result = await resolveOidcUser({ iss: ISS, sub: `second-${Date.now()}`, emailVerified: true }, { linkUserId: linked.id });

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
      iss: ISS,
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
    const result = await resolveOidcUser({ iss: ISS, sub: `sub-${Date.now()}`, emailVerified: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_email");
  });

  describe("issuer scoping", () => {
    const userIds: string[] = [];

    afterEach(async () => {
      for (const id of userIds.splice(0)) await cleanupTestUser(id);
    });

    it("does not hand an account to the same subject from a different issuer", async () => {
      const sub = "7";
      const original = await db.user.create({
        data: { email: `oidc-old-idp-${Date.now()}@example.com`, name: "Old IdP", oidcIssuer: ISS, oidcSubject: sub },
      });
      userIds.push(original.id);

      const result = await resolveOidcUser({
        iss: "https://new-idp.example.com",
        sub,
        email: `oidc-new-idp-${Date.now()}@example.com`,
        emailVerified: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        userIds.push(result.user.id);
        expect(result.user.id).not.toBe(original.id);
        expect(result.user.oidcIssuer).toBe("https://new-idp.example.com");
      }
    });

    it("refuses a different issuer's subject that arrives with the email of an already-linked account", async () => {
      const email = `oidc-same-email-${Date.now()}@example.com`;
      const original = await db.user.create({ data: { email, name: "Old IdP", oidcIssuer: ISS, oidcSubject: "7" } });
      userIds.push(original.id);

      const result = await resolveOidcUser({ iss: "https://new-idp.example.com", sub: "7", email, emailVerified: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("linked_elsewhere");
    });

    it("records the issuer on an account linked before issuers were stored, then scopes it to that issuer", async () => {
      const sub = `legacy-${Date.now()}`;
      const legacy = await db.user.create({
        data: { email: `oidc-legacy-${Date.now()}@example.com`, name: "Legacy", oidcSubject: sub },
      });
      userIds.push(legacy.id);

      const login = await resolveOidcUser({ iss: ISS, sub, emailVerified: true });
      expect(login.ok).toBe(true);
      if (login.ok) expect(login.user.id).toBe(legacy.id);
      expect((await db.user.findUnique({ where: { id: legacy.id } }))?.oidcIssuer).toBe(ISS);

      const otherIssuer = await resolveOidcUser({
        iss: "https://new-idp.example.com",
        sub,
        email: `oidc-legacy-other-${Date.now()}@example.com`,
        emailVerified: true,
      });
      expect(otherIssuer.ok).toBe(true);
      if (otherIssuer.ok) {
        userIds.push(otherIssuer.user.id);
        expect(otherIssuer.user.id).not.toBe(legacy.id);
      }
    });
  });
});
