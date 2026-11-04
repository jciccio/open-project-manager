import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../inbound-email/route";
import { proxy } from "@/proxy";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";

describe("POST /api/v1/inbound-email", () => {
  let userId: string;
  let token: string;
  let projectKey: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`inbound-api-user-${Date.now()}`);
    userId = userRes.user.id;
    token = userRes.token;

    const project = await createTestProject(userId, "Inbound API Project");
    projectKey = project.key;

    await db.column.create({
      data: {
        projectId: project.id,
        name: "Backlog",
        group: "BACKLOG",
        order: 1,
      },
    });
  });

  afterEach(async () => {
    delete process.env.INBOUND_EMAIL_TOKEN;
    await cleanupTestUser(userId);
  });

  it("returns 401 when unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: "user@example.com",
        subject: "Title",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("authorizes via INBOUND_EMAIL_TOKEN secret header and creates card", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });

    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "Inbound card via webhook token",
        text: "Card description from email.",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.title).toBe("Inbound card via webhook token");
    expect(body.data.identifier).toBe(`${projectKey}-1`);
  });

  it("authorizes via Bearer token and creates card", async () => {
    const user = await db.user.findUnique({ where: { id: userId } });

    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "Inbound card via Bearer token",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.title).toBe("Inbound card via Bearer token");
  });

  it("returns 400 for invalid payload", async () => {
    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: "",
        from: "",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("prevents caller from spoofing another user when authenticating with a session token", async () => {
    const attackerRes = await createTestUser(`inbound-attacker-${Date.now()}`);
    const victim = await db.user.findUnique({ where: { id: userId } });

    // Attacker tries to post with victim's email in 'from'
    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attackerRes.token}`,
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: victim!.email,
        subject: "Planted malicious card",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(false);
    expect(body.error).toContain("Inbound email rejected");

    await cleanupTestUser(attackerRes.user.id);
  });

  it("returns 401 when INBOUND_EMAIL_TOKEN is incorrect or timing-mismatched with same-length wrong token", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "correct-token-val-1";
    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "wrong-token-value-99", // exactly same length (20 chars)
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: "any@example.com",
        subject: "Test",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("authorizes when valid X-Inbound-Token is provided even with an unrelated Bearer token", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "correct-token-val-1";
    const user = await db.user.findUnique({ where: { id: userId } });

    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "correct-token-val-1",
        Authorization: "Bearer unrelated-opaque-bearer-token",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "Card with both headers",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("rejects email when SPF or DKIM validation indicates failure", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });

    const reqSpfFail = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "SPF failing mail",
        spf: "fail",
      }),
    });

    const resSpf = await POST(reqSpfFail);
    expect(resSpf.status).toBe(200);
    const bodySpf = await resSpf.json();
    expect(bodySpf.accepted).toBe(false);
    expect(bodySpf.error).toContain("SPF validation failed");

    const reqDkimFail = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "DKIM failing mail",
        dkim: "fail",
      }),
    });

    const resDkim = await POST(reqDkimFail);
    expect(resDkim.status).toBe(200);
    const bodyDkim = await resDkim.json();
    expect(bodyDkim.accepted).toBe(false);
    expect(bodyDkim.error).toContain("DKIM validation failed");
  });

  it("allows unauthenticated requests through proxy for public inbound-email path", async () => {
    const proxyReq = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
    });

    const proxyRes = await proxy(proxyReq);
    // Should not return 401 Unauthorized
    expect(proxyRes.status).not.toBe(401);
  });
});
