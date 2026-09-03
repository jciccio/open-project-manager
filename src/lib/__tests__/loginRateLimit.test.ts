import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimit,
} from "../loginRateLimit";

describe("loginRateLimit", () => {
  beforeEach(() => {
    resetLoginRateLimit();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows attempts under the per-email threshold", () => {
    for (let i = 0; i < 4; i++) {
      expect(checkLoginRateLimit("user@example.com").allowed).toBe(true);
      recordLoginFailure("user@example.com");
    }
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(true);
  });

  it("locks out an email after the threshold is reached", () => {
    for (let i = 0; i < 5; i++) {
      recordLoginFailure("user@example.com");
    }
    const result = checkLoginRateLimit("user@example.com");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("normalizes email case and whitespace for the same bucket", () => {
    for (let i = 0; i < 5; i++) {
      recordLoginFailure("  User@Example.com  ");
    }
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(false);
  });

  it("a successful login clears the failure count", () => {
    for (let i = 0; i < 4; i++) {
      recordLoginFailure("user@example.com");
    }
    recordLoginSuccess("user@example.com");
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(true);

    for (let i = 0; i < 4; i++) {
      recordLoginFailure("user@example.com");
    }
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(true);
  });

  it("does not lock out a different email", () => {
    for (let i = 0; i < 5; i++) {
      recordLoginFailure("attacker-target@example.com");
    }
    expect(checkLoginRateLimit("someone-else@example.com").allowed).toBe(true);
  });

  it("the lockout expires after the window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    for (let i = 0; i < 5; i++) {
      recordLoginFailure("user@example.com");
    }
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
    expect(checkLoginRateLimit("user@example.com").allowed).toBe(true);
  });

  it("does not apply per-IP limiting when no IP is provided", () => {
    for (let i = 0; i < 30; i++) {
      recordLoginFailure(`user${i}@example.com`);
    }
    expect(checkLoginRateLimit("yet-another@example.com").allowed).toBe(true);
  });

  it("locks out an IP after its (higher) threshold is reached, across different emails", () => {
    for (let i = 0; i < 25; i++) {
      recordLoginFailure(`user${i}@example.com`, "203.0.113.5");
    }
    const result = checkLoginRateLimit("brand-new-email@example.com", "203.0.113.5");
    expect(result.allowed).toBe(false);
  });

  it("does not lock out a different IP", () => {
    for (let i = 0; i < 25; i++) {
      recordLoginFailure(`user${i}@example.com`, "203.0.113.5");
    }
    expect(checkLoginRateLimit("someone@example.com", "203.0.113.99").allowed).toBe(true);
  });
});
