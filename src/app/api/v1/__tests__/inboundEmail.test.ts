import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../inbound-email/route";
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
});
