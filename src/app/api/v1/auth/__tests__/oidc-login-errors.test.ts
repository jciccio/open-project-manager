import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => {
    throw new Error("getaddrinfo ENOTFOUND idp.example.com");
  }),
  allowInsecureRequests: vi.fn(),
}));

import { GET as oidcLogin } from "../oidc/login/route";

describe("OIDC login route failures", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OIDC_ISSUER_URL = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "client-id";
    process.env.OIDC_CLIENT_SECRET = "client-secret";
    process.env.OIDC_REDIRECT_URI = "https://opm.example.com/api/v1/auth/oidc/callback";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("redirects to login with oidc_failed and logs when discovery fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await oidcLogin(new NextRequest("https://opm.example.com/api/v1/auth/oidc/login"));

    expect(res.headers.get("location")).toBe("https://opm.example.com/login?error=oidc_failed");
    expect(res.cookies.get("opm_oidc_state")).toBeUndefined();
    expect(error).toHaveBeenCalledWith("OIDC login error:", expect.any(Error));
  });
});
