import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { GET as getWebhooksRoute, POST as createWebhookRoute } from "../webhooks/route";
import { GET as getSingleWebhookRoute, PUT as updateWebhookRoute, DELETE as deleteWebhookRoute } from "../webhooks/[id]/route";
import { NextRequest } from "next/server";

describe("REST API: Webhooks", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`api-webhook-user-${Date.now()}`);
    userId = userRes.user.id;
    token = userRes.token;

    const project = await createTestProject(userId, "REST Webhook Project");
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 401 without authorization", async () => {
    const req = new NextRequest("http://localhost/api/v1/webhooks?projectId=foo");
    const res = await getWebhooksRoute(req);
    expect(res.status).toBe(401);
  });

  it("requires projectId on GET", async () => {
    const req = new NextRequest("http://localhost/api/v1/webhooks", {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await getWebhooksRoute(req);
    expect(res.status).toBe(400);
  });

  it("creates, lists, gets, updates, and deletes a webhook via REST API", async () => {
    const createReq = new NextRequest("http://localhost/api/v1/webhooks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        url: "https://example.com/hook",
        events: ["card_created", "project_created"],
      }),
    });
    const createRes = await createWebhookRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const webhookId = createBody.data.id;
    expect(createBody.data.url).toBe("https://example.com/hook");
    expect(createBody.data.secret).toMatch(/^[0-9a-f]{64}$/);

    // List — secret must never be present here
    const listReq = new NextRequest(`http://localhost/api/v1/webhooks?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getWebhooksRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].id).toBe(webhookId);
    expect(listBody.data[0].secret).toBeUndefined();

    // Get single — secret must never be present here either
    const getReq = new NextRequest(`http://localhost/api/v1/webhooks/${webhookId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getRes = await getSingleWebhookRoute(getReq, { params: Promise.resolve({ id: webhookId }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.url).toBe("https://example.com/hook");
    expect(getBody.data.secret).toBeUndefined();

    // Update
    const updateReq = new NextRequest(`http://localhost/api/v1/webhooks/${webhookId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ events: ["comment_added"], isActive: false }),
    });
    const updateRes = await updateWebhookRoute(updateReq, { params: Promise.resolve({ id: webhookId }) });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(JSON.parse(updateBody.data.eventsJson)).toEqual(["comment_added"]);
    expect(updateBody.data.isActive).toBe(false);

    // Delete
    const deleteReq = new NextRequest(`http://localhost/api/v1/webhooks/${webhookId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteRes = await deleteWebhookRoute(deleteReq, { params: Promise.resolve({ id: webhookId }) });
    expect(deleteRes.status).toBe(200);

    const verifyListRes = await getWebhooksRoute(listReq);
    const verifyBody = await verifyListRes.json();
    expect(verifyBody.data.length).toBe(0);
  });

  it("rejects creating a webhook for a project the caller doesn't own", async () => {
    const otherUser = await createTestUser(`other-api-webhook-${Date.now()}`);

    const createReq = new NextRequest("http://localhost/api/v1/webhooks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${otherUser.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        url: "https://example.com/hook",
        events: ["card_created"],
      }),
    });
    const createRes = await createWebhookRoute(createReq);
    expect(createRes.status).toBe(400);

    await cleanupTestUser(otherUser.user.id);
  });
});
