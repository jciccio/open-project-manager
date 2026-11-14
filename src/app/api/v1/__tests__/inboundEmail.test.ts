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
        dmarc: "pass",
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
        dmarc: "pass",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("rejects webhook email unless DMARC passes or DKIM aligns with From domain", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });
    const userDomain = user!.email.split("@")[1];

    const failingCases: Array<Record<string, string>> = [
      {}, // missing verdicts
      { spf: "fail" },
      { spf: " fail " },
      { spf: "softfail" },
      { spf: "none", dkim: "none" },
      { spf: "neutral" },
      { spf: "permerror" },
      { dkim: "temperror" },
      { dkim: "fail" },
      { dkim: "{@evil.com : fail}" },
      { spf: "pass", dkim: "pass" }, // bare pass without DMARC or domain
      { spf: "pass", dkim: "{@evil.com : pass}" }, // unaligned domain pass
      { dmarc: "fail" },
      { dmarc: "none" },
    ];

    for (const verdictFields of failingCases) {
      const req = new NextRequest("http://localhost/api/v1/inbound-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Inbound-Token": "secret-webhook-key-123",
        },
        body: JSON.stringify({
          to: `opm+${projectKey}@opm.local`,
          from: user!.email,
          subject: "Auth failing mail",
          ...verdictFields,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(false);
      expect(body.error).toContain("Inbound email rejected");
    }

    // Domain-aligned DKIM pass succeeds without explicit DMARC field
    const alignedReq = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "Aligned DKIM pass",
        spf: "pass",
        dkim: `{@mail.${userDomain} : pass}`,
      }),
    });
    const alignedRes = await POST(alignedReq);
    expect(alignedRes.status).toBe(201);
  });

  it("deduplicates retried webhook deliveries and prevents duplicate card creation", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });

    const payload = {
      to: `opm+${projectKey}@opm.local`,
      from: user!.email,
      subject: "Webhook retry test",
      text: "Testing retried deliveries",
      dmarc: "pass",
      messageId: "<msg-retry-test-1@domain.com>",
    };

    const req1 = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify(payload),
    });

    const res1 = await POST(req1);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.duplicate).toBeUndefined();

    // Send exact same payload second time
    const req2 = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify(payload),
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.duplicate).toBe(true);
    expect(body2.data.id).toBe(body1.data.id);

    const count = await db.card.count({ where: { projectId: body1.data.projectId, messageId: "<msg-retry-test-1@domain.com>" } });
    expect(count).toBe(1);
  });

  it("routes card creation when project address is in CC header", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });

    const req = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: "alice@acme.com",
        cc: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "Card from CC route",
        dmarc: "pass",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.title).toBe("Card from CC route");
  });

  it("returns 200 rejected (not 400) for oversized mail bodies and accepts large CC lists over HTTP", async () => {
    process.env.INBOUND_EMAIL_TOKEN = "secret-webhook-key-123";
    const user = await db.user.findUnique({ where: { id: userId } });

    const oversizedReq = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: `opm+${projectKey}@opm.local`,
        from: user!.email,
        subject: "1.2MB newsletter",
        html: `<p>${"X".repeat(1200 * 1024)}</p>`,
        dmarc: "pass",
      }),
    });
    const oversizedRes = await POST(oversizedReq);
    expect(oversizedRes.status).toBe(200);
    const oversizedBody = await oversizedRes.json();
    expect(oversizedBody.accepted).toBe(false);
    expect(oversizedBody.error).toContain("exceeds maximum size limit");

    // 60 Cc addresses (>2000 chars) should route and succeed with 201 instead of 400
    const sixtyCcs = Array.from({ length: 60 }, (_, i) => `person-long-name-${i}@corp.example.com`).concat([
      `opm+${projectKey}@opm.local`,
    ]);
    const ccString = sixtyCcs.join(", ");
    expect(ccString.length).toBeGreaterThan(2000);

    const largeCcReq = new NextRequest("http://localhost/api/v1/inbound-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Token": "secret-webhook-key-123",
      },
      body: JSON.stringify({
        to: "team@acme.com",
        cc: ccString,
        from: user!.email,
        subject: "Email with 60 Cc addresses",
        dmarc: "pass",
      }),
    });
    const largeCcRes = await POST(largeCcReq);
    expect(largeCcRes.status).toBe(201);
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
