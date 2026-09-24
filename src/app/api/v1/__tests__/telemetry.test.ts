import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET, PATCH } from "../system/telemetry/route";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import path from "path";
import fs from "fs";

describe("REST API: System Telemetry", () => {
  let userId: string;
  let token: string;
  const originalEnv = { ...process.env };
  const testDataDir = path.join(process.cwd(), "data", "test-telemetry-api");

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.DATA_DIR = testDataDir;
    process.env.FORCE_TELEMETRY_TEST = "true";

    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }

    const res = await createTestUser(`api-telemetry-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
    process.env = originalEnv;
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it("returns 401 Unauthorized when no token is provided", async () => {
    const req = new NextRequest("http://localhost/api/v1/system/telemetry", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns telemetry status and payload when authenticated", async () => {
    const req = new NextRequest("http://localhost/api/v1/system/telemetry", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("instanceId");
    expect(body.data).toHaveProperty("enabled");
    expect(body.data).toHaveProperty("payload");
  });

  it("updates telemetry preference via PATCH", async () => {
    // 1. Disable telemetry
    const patchReq = new NextRequest("http://localhost/api/v1/system/telemetry", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });

    const patchRes = await PATCH(patchReq);
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.success).toBe(true);
    expect(patchBody.data.enabled).toBe(false);

    // 2. Fetch GET to verify persistence
    const getReq = new NextRequest("http://localhost/api/v1/system/telemetry", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    expect(getBody.data.enabled).toBe(false);
  });

  it("rejects invalid payload without boolean 'enabled'", async () => {
    const patchReq = new NextRequest("http://localhost/api/v1/system/telemetry", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: "not-a-boolean" }),
    });

    const patchRes = await PATCH(patchReq);
    expect(patchRes.status).toBe(400);
  });
});
