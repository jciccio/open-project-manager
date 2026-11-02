import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../session-expired/route";
import { middleware } from "@/middleware";

describe("GET /api/v1/auth/session-expired", () => {
  it("clears the session cookie and sends the browser to /login", async () => {
    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
    const cleared = res.cookies.get("opm_session");
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge ?? 0).toBeLessThanOrEqual(0);
  });

  it("is reachable without a valid session, so a rejected cookie cannot block it", async () => {
    const res = await middleware(new NextRequest("http://localhost/api/v1/auth/session-expired"));

    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
