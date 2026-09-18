import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("throws at import if JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    await expect(import("../env")).rejects.toThrow(/JWT_SECRET/);
  });

  it("throws at import if JWT_SECRET is shorter than 32 characters", async () => {
    process.env.JWT_SECRET = "too-short";
    await expect(import("../env")).rejects.toThrow(/JWT_SECRET/);
  });

  it("succeeds and exposes JWT_SECRET when the secret is long enough", async () => {
    process.env.JWT_SECRET = "a".repeat(32);
    const mod = await import("../env");
    expect(mod.JWT_SECRET).toBeInstanceOf(Uint8Array);
    expect(mod.JWT_SECRET.length).toBe(32);
  });

  it("encodes the secret identically to the previous Buffer.from-based approach", async () => {
    const secret = "test-jwt-secret-do-not-use-in-production";
    process.env.JWT_SECRET = secret;
    const mod = await import("../env");
    expect(Buffer.compare(Buffer.from(mod.JWT_SECRET), Buffer.from(secret))).toBe(0);
  });
});
