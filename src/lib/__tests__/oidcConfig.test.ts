import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const openid = vi.hoisted(() => ({
  discovery: vi.fn(async () => ({})),
  allowInsecureRequests: vi.fn(),
}));

vi.mock("openid-client", () => ({
  discovery: openid.discovery,
  allowInsecureRequests: openid.allowInsecureRequests,
}));

const OIDC_ENV = {
  OIDC_ISSUER_URL: "https://idp.example.com",
  OIDC_CLIENT_ID: "client-id",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_REDIRECT_URI: "https://opm.example.com/api/v1/auth/oidc/callback",
};

// oidc.ts caches discovery and the missing-variable warning per process, so
// every test loads a fresh copy of the module.
async function loadOidc() {
  vi.resetModules();
  return import("../oidc");
}

describe("OIDC configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, OIDC_ENV);
    delete process.env.OIDC_ALLOW_INSECURE;
    openid.discovery.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("refuses an http: issuer without OIDC_ALLOW_INSECURE and never calls discovery", async () => {
    process.env.OIDC_ISSUER_URL = "http://idp.lan";
    const { getOidcConfig } = await loadOidc();

    await expect(getOidcConfig()).rejects.toThrow("OIDC_ALLOW_INSECURE");
    expect(openid.discovery).not.toHaveBeenCalled();
  });

  it("allows an http: issuer for discovery and later requests when OIDC_ALLOW_INSECURE=true", async () => {
    process.env.OIDC_ISSUER_URL = "http://idp.lan";
    process.env.OIDC_ALLOW_INSECURE = "true";
    const { getOidcConfig } = await loadOidc();

    await getOidcConfig();

    expect(openid.discovery).toHaveBeenCalledWith(new URL("http://idp.lan"), "client-id", "client-secret", undefined, {
      execute: [openid.allowInsecureRequests],
    });
  });

  it("keeps the HTTPS-only default for an https: issuer", async () => {
    const { getOidcConfig } = await loadOidc();

    await getOidcConfig();

    expect(openid.discovery).toHaveBeenCalledWith(
      new URL("https://idp.example.com"),
      "client-id",
      "client-secret",
      undefined,
      undefined
    );
  });

  it("logs once which OIDC variables are missing when only some are set", async () => {
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isOidcConfigured } = await loadOidc();

    expect(isOidcConfigured()).toBe(false);
    expect(isOidcConfigured()).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI");
  });

  it("stays quiet when no OIDC variable is set", async () => {
    for (const name of Object.keys(OIDC_ENV)) delete process.env[name];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isOidcConfigured } = await loadOidc();

    expect(isOidcConfigured()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
