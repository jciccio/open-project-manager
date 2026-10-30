import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createCard, updateCard, moveCard } from "@/lib/services/cards";
import { addComment } from "@/lib/services/comments";
import { createWebhook } from "@/lib/services/webhooks";
import { archiveCard, unarchiveCard } from "@/actions/cards";
import { createSession, destroySession } from "@/lib/auth";
import { cleanupTestUser, createTestCard, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";

const activityWrites = vi.hoisted(() => ({ fail: false }));

// A failing write is a real Prisma query (a required column set to null), so it
// fails the same way inside batch and interactive transactions.
vi.mock("@/lib/services/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/activity")>();
  return {
    ...actual,
    createActivities: (...[client, entries]: Parameters<typeof actual.createActivities>) =>
      activityWrites.fail
        ? client.activity.createMany({ data: entries.map((entry) => ({ ...entry, type: null as never })) })
        : actual.createActivities(client, entries),
  };
});

describe("activity rows commit or roll back with the change they record", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { user } = await createTestUser(`activity-atomic-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });
    projectId = (await createTestProject(userId, "Activity Atomicity")).id;
    columnId = (await createTestColumn(projectId, "To Do", 0)).id;
    otherColumnId = (await createTestColumn(projectId, "Doing", 1)).id;
    await createWebhook(
      projectId,
      {
        url: "https://example.com/hook",
        events: ["card_created", "title_changed", "moved", "comment_added", "archived", "unarchived"],
      },
      userId
    );
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    activityWrites.fail = false;
  });

  afterEach(async () => {
    activityWrites.fail = false;
    vi.unstubAllGlobals();
    await destroySession();
    await cleanupTestUser(userId);
  });

  // triggerWebhooks is not awaited and queries the webhook rows before fetch().
  async function flushWebhooks() {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  it("createCard creates no card and sends no webhook when the activity write fails", async () => {
    activityWrites.fail = true;
    const res = await createCard({ projectId, columnId, title: "Never created" }, userId);
    await flushWebhooks();

    expect(res.success).toBe(false);
    expect(await db.card.count({ where: { projectId } })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updateCard leaves the card unchanged and sends no webhook when the activity write fails", async () => {
    const card = await createTestCard(projectId, columnId, "Before");
    activityWrites.fail = true;
    const res = await updateCard(card.id, { title: "After" }, userId);
    await flushWebhooks();

    expect(res.success).toBe(false);
    expect((await db.card.findUnique({ where: { id: card.id } }))!.title).toBe("Before");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moveCard leaves the card in its column and sends no webhook when the activity write fails", async () => {
    const card = await createTestCard(projectId, columnId);
    activityWrites.fail = true;
    const res = await moveCard(card.id, otherColumnId, 0, userId);
    await flushWebhooks();

    expect(res.success).toBe(false);
    expect((await db.card.findUnique({ where: { id: card.id } }))!.columnId).toBe(columnId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("addComment stores no comment and sends no webhook when the activity write fails", async () => {
    const card = await createTestCard(projectId, columnId);
    activityWrites.fail = true;
    const res = await addComment(card.id, "Me", "Hello", userId);
    await flushWebhooks();

    expect(res.success).toBe(false);
    expect(await db.comment.count({ where: { cardId: card.id } })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("archiveCard and unarchiveCard keep the archived flag and send no webhook when the activity write fails", async () => {
    const card = await createTestCard(projectId, columnId);
    activityWrites.fail = true;
    expect((await archiveCard(card.id)).success).toBe(false);
    expect((await db.card.findUnique({ where: { id: card.id } }))!.isArchived).toBe(false);

    await db.card.update({ where: { id: card.id }, data: { isArchived: true } });
    expect((await unarchiveCard(card.id)).success).toBe(false);
    expect((await db.card.findUnique({ where: { id: card.id } }))!.isArchived).toBe(true);

    await flushWebhooks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updateCard returns the card with this change's activity row and fires its webhook after commit", async () => {
    const card = await createTestCard(projectId, columnId, "Before");
    const res = await updateCard(card.id, { title: "After" }, userId);
    await flushWebhooks();

    expect(res.success).toBe(true);
    expect(res.data!.activities.map((a: { type: string }) => a.type)).toContain("title_changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).event).toBe("title_changed");
  });
});
