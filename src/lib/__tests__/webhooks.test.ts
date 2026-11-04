import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { createWebhook } from "@/lib/services/webhooks";
import { triggerWebhooks } from "@/lib/webhooks";

describe("triggerWebhooks", () => {
  let userId: string;
  let projectId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const userRes = await createTestUser(`lib-webhook-user-${Date.now()}`);
    userId = userRes.user.id;

    const project = await createTestProject(userId, "Webhook Lib Test Project");
    projectId = project.id;

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTestUser(userId);
  });

  it("delivers a correctly signed payload only to webhooks subscribed to the event", async () => {
    const subscribed = await createWebhook(
      projectId,
      { url: "https://example.com/subscribed", events: ["card_created"] },
      userId
    );
    await createWebhook(
      projectId,
      { url: "https://example.com/not-subscribed", events: ["comment_added"] },
      userId
    );

    await triggerWebhooks(projectId, "card_created", { cardId: "card1", toValue: "Task" });
    // fetch() is fired without being awaited inside triggerWebhooks — flush microtasks.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/subscribed");

    const body = options.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe("card_created");
    expect(parsed.cardId).toBe("card1");
    expect(parsed.toValue).toBe("Task");

    const expectedSignature = crypto
      .createHmac("sha256", subscribed.data!.secret)
      .update(body)
      .digest("hex");
    expect(options.headers["X-OPM-Signature"]).toBe(`sha256=${expectedSignature}`);
    expect(options.headers["X-OPM-Event"]).toBe("card_created");
    expect(options.headers["X-OPM-Delivery"]).toBeTruthy();
  });

  it("skips inactive webhooks", async () => {
    const created = await createWebhook(
      projectId,
      { url: "https://example.com/inactive", events: ["card_created"] },
      userId
    );
    await db.webhook.update({ where: { id: created.data!.id }, data: { isActive: false } });

    await triggerWebhooks(projectId, "card_created", { cardId: "card1" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the project has no webhooks", async () => {
    await triggerWebhooks(projectId, "card_created", { cardId: "card1" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries failed deliveries on 5xx up to MAX_ATTEMPTS", async () => {
    await createWebhook(
      projectId,
      { url: "https://example.com/retry-test", events: ["card_created"] },
      userId
    );

    // Fail first attempt with 500, succeed on second
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await triggerWebhooks(projectId, "card_created", { cardId: "card-retry" });
    // Allow retries to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCallHeaders = fetchMock.mock.calls[0][1].headers;
    const secondCallHeaders = fetchMock.mock.calls[1][1].headers;
    expect(firstCallHeaders["X-OPM-Attempt"]).toBe("1");
    expect(secondCallHeaders["X-OPM-Attempt"]).toBe("2");
  });

  it("does not retry on 4xx client errors (e.g. 404)", async () => {
    await createWebhook(
      projectId,
      { url: "https://example.com/client-error", events: ["card_created"] },
      userId
    );

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    await triggerWebhooks(projectId, "card_created", { cardId: "card-404" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["X-OPM-Attempt"]).toBe("1");
  });
});
