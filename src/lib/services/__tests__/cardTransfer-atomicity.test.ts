import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { moveCardToProject } from "@/lib/services/cardTransfer";
import { cleanupTestUser, createTestCard, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";

const control = vi.hoisted(() => ({ failActivity: false, staleNumber: null as number | null }));

vi.mock("@/lib/webhooks", () => ({ triggerWebhooks: vi.fn() }));

// The activity rows are the last write of the move, so failing them proves the
// card updates, labels and types written before them roll back too.
vi.mock("@/lib/services/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/activity")>();
  return {
    ...actual,
    createActivities: (...[client, entries]: Parameters<typeof actual.createActivities>) =>
      control.failActivity
        ? client.activity.createMany({ data: entries.map((entry) => ({ ...entry, type: null as never })) })
        : actual.createActivities(client, entries),
  };
});

vi.mock("@/lib/cardNumbering", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cardNumbering")>();
  return {
    ...actual,
    nextCardNumber: async (projectId: string) => {
      if (control.staleNumber !== null) {
        const stale = control.staleNumber;
        control.staleNumber = null;
        return stale;
      }
      return actual.nextCardNumber(projectId);
    },
  };
});

describe("moveCardToProject is all or nothing", () => {
  let userId: string;
  let sourceId: string;
  let targetId: string;
  let sourceColumnId: string;
  let targetColumnId: string;

  beforeEach(async () => {
    control.failActivity = false;
    control.staleNumber = null;
    userId = (await createTestUser(`transfer-atomic-${Date.now()}`)).user.id;
    sourceId = (await createTestProject(userId, "Atomic Source")).id;
    targetId = (await createTestProject(userId, "Atomic Target")).id;
    sourceColumnId = (await createTestColumn(sourceId)).id;
    targetColumnId = (await createTestColumn(targetId)).id;
  });

  afterEach(async () => {
    control.failActivity = false;
    control.staleNumber = null;
    await cleanupTestUser(userId);
  });

  it("leaves the card, its subtask, labels and the target project untouched when a write fails", async () => {
    const label = await db.label.create({ data: { projectId: sourceId, name: "only-in-source", color: "#123456" } });
    const parent = await createTestCard(sourceId, sourceColumnId, "Parent");
    const child = await createTestCard(sourceId, sourceColumnId, "Child");
    await db.card.update({ where: { id: child.id }, data: { parentId: parent.id, labels: { create: [{ labelId: label.id }] } } });
    control.failActivity = true;

    const res = await moveCardToProject(parent.id, targetId, userId);

    expect(res.success).toBe(false);
    const cards = await db.card.findMany({
      where: { id: { in: [parent.id, child.id] } },
      include: { labels: true },
      orderBy: { number: "asc" },
    });
    expect(cards.map((c) => [c.projectId, c.number, c.labels.map((l) => l.labelId)])).toEqual([
      [sourceId, 1, []],
      [sourceId, 2, [label.id]],
    ]);
    expect(await db.label.count({ where: { projectId: targetId } })).toBe(0);
    expect(await db.card.count({ where: { projectId: targetId } })).toBe(0);
  });

  it("retries with a fresh number when the first one is already taken", async () => {
    await createTestCard(targetId, targetColumnId, "Holds number 1");
    const card = await createTestCard(sourceId, sourceColumnId, "Mover");
    control.staleNumber = 1;

    const res = await moveCardToProject(card.id, targetId, userId);

    expect(res.success).toBe(true);
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).number).toBe(2);
  });
});
