import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { listWebhooks, createWebhook, updateWebhook, deleteWebhook } from "@/actions/webhooks";

describe("Webhook Actions", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`webhook-user-${Date.now()}`);
    userId = userRes.user.id;

    const project = await createTestProject(userId, "Webhook Test Project");
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("creates, lists, updates, and deletes a webhook", async () => {
    const createRes = await createWebhook(
      projectId,
      { url: "https://example.com/hook", events: ["card_created", "moved"] },
      userId
    );
    expect(createRes.success).toBe(true);
    expect(createRes.data?.url).toBe("https://example.com/hook");
    expect(createRes.data?.secret).toMatch(/^[0-9a-f]{64}$/);
    const webhookId = createRes.data!.id;

    const listRes = await listWebhooks(projectId, userId);
    expect(listRes.success).toBe(true);
    expect(listRes.data?.length).toBe(1);
    expect(listRes.data![0].id).toBe(webhookId);
    expect(listRes.data![0]).not.toHaveProperty("secret");

    const updateRes = await updateWebhook(
      webhookId,
      { events: ["comment_added"], isActive: false },
      userId
    );
    expect(updateRes.success).toBe(true);
    expect(JSON.parse(updateRes.data!.eventsJson)).toEqual(["comment_added"]);
    expect(updateRes.data?.isActive).toBe(false);
    expect(updateRes.data).not.toHaveProperty("secret");

    const deleteRes = await deleteWebhook(webhookId, userId);
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.deletedId).toBe(webhookId);

    const postDeleteList = await listWebhooks(projectId, userId);
    expect(postDeleteList.data?.length).toBe(0);
  });

  it("rejects webhook creation without a URL or events", async () => {
    const noUrl = await createWebhook(projectId, { url: "", events: ["card_created"] }, userId);
    expect(noUrl.success).toBe(false);

    const noEvents = await createWebhook(projectId, { url: "https://example.com/hook", events: [] }, userId);
    expect(noEvents.success).toBe(false);
  });

  it("rejects access to a webhook from a project the caller doesn't own", async () => {
    const otherUser = await createTestUser(`other-webhook-${Date.now()}`);

    const createRes = await createWebhook(
      projectId,
      { url: "https://example.com/hook", events: ["card_created"] },
      otherUser.user.id
    );
    expect(createRes.success).toBe(false);
    expect(createRes.error).toBe("Project not found or access denied");

    const ownRes = await createWebhook(
      projectId,
      { url: "https://example.com/hook", events: ["card_created"] },
      userId
    );
    const webhookId = ownRes.data!.id;

    const updateRes = await updateWebhook(webhookId, { url: "https://evil.example.com" }, otherUser.user.id);
    expect(updateRes.success).toBe(false);

    const deleteRes = await deleteWebhook(webhookId, otherUser.user.id);
    expect(deleteRes.success).toBe(false);

    await cleanupTestUser(otherUser.user.id);
  });
});
