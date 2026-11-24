import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { triggerWebhooks } from "@/lib/webhooks";
import {
  cleanupTestUser,
  createTestCard,
  createTestCardType,
  createTestProject,
  createTestUser,
} from "@/test/helpers";
import { moveCardToProject } from "@/lib/services/cardTransfer";
import { getCardByIdentifier } from "@/lib/services/cards";

vi.mock("@/lib/webhooks", () => ({ triggerWebhooks: vi.fn() }));

function uniqueKey(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`.toUpperCase();
}

async function createGroupedColumn(projectId: string, name: string, order: number, group: string, isDone = false) {
  return db.column.create({ data: { projectId, name, order, group, isDone } });
}

describe("moveCardToProject", () => {
  let userId: string;
  let source: { id: string; key: string };
  let target: { id: string; key: string };
  let sourceTodo: string;
  let sourceDone: string;
  let targetTodo: string;
  let targetDone: string;

  beforeEach(async () => {
    vi.mocked(triggerWebhooks).mockClear();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    userId = (await createTestUser(`transfer-${stamp}`)).user.id;
    source = await createTestProject(userId, "Transfer Source", uniqueKey("S"));
    target = await createTestProject(userId, "Transfer Target", uniqueKey("T"));
    sourceTodo = (await createGroupedColumn(source.id, "Todo", 0, "UNSTARTED")).id;
    sourceDone = (await createGroupedColumn(source.id, "Done", 1, "COMPLETED", true)).id;
    targetTodo = (await createGroupedColumn(target.id, "Todo", 0, "UNSTARTED")).id;
    targetDone = (await createGroupedColumn(target.id, "Shipped", 1, "COMPLETED", true)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("moves a card and its subtasks, numbering them after the target's highest card", async () => {
    await createTestCard(target.id, targetTodo, "Existing 1");
    await createTestCard(target.id, targetTodo, "Existing 2");
    const parent = await createTestCard(source.id, sourceTodo, "Parent");
    const child = await createTestCard(source.id, sourceDone, "Child");
    await db.card.update({ where: { id: child.id }, data: { parentId: parent.id, completedAt: new Date("2026-01-02") } });

    const res = await moveCardToProject(parent.id, target.id, userId);

    expect(res.success).toBe(true);
    expect(res.success && res.data.moved).toEqual([
      { from: `${source.key}-1`, to: `${target.key}-3` },
      { from: `${source.key}-2`, to: `${target.key}-4` },
    ]);
    const [movedParent, movedChild] = await Promise.all([
      db.card.findUniqueOrThrow({ where: { id: parent.id } }),
      db.card.findUniqueOrThrow({ where: { id: child.id } }),
    ]);
    expect(movedParent).toMatchObject({ projectId: target.id, number: 3, columnId: targetTodo, completedAt: null });
    expect(movedChild).toMatchObject({ projectId: target.id, number: 4, columnId: targetDone, parentId: parent.id });
    expect(movedChild.completedAt).toEqual(new Date("2026-01-02"));
    expect(await db.card.count({ where: { projectId: source.id } })).toBe(0);
  });

  it("keeps comments, links and relations, and records the move", async () => {
    const card = await createTestCard(source.id, sourceTodo, "With history");
    const other = await createTestCard(source.id, sourceTodo, "Related");
    await db.comment.create({ data: { cardId: card.id, content: "kept", author: "someone" } });
    await db.cardLink.create({ data: { cardId: card.id, url: "https://example.com", title: "Docs" } });
    await db.cardRelation.create({ data: { sourceCardId: card.id, targetCardId: other.id, type: "BLOCKS" } });

    await moveCardToProject(card.id, target.id, userId);

    expect(await db.comment.count({ where: { cardId: card.id } })).toBe(1);
    expect(await db.cardLink.count({ where: { cardId: card.id } })).toBe(1);
    expect(await db.cardRelation.count({ where: { sourceCardId: card.id, targetCardId: other.id } })).toBe(1);
    const activity = await db.activity.findFirstOrThrow({ where: { cardId: card.id, type: "project_changed" } });
    expect(activity).toMatchObject({ fromValue: `${source.key}-1`, toValue: `${target.key}-1`, actorUserId: userId });
    expect(vi.mocked(triggerWebhooks).mock.calls.map(([projectId, event]) => [projectId, event])).toEqual([
      [target.id, "project_changed"],
    ]);
  });

  it("maps project labels and the card type by name, creating missing ones, and keeps global labels", async () => {
    const sourceType = await createTestCardType(source.id, "Bug", "Bug", "#ef4444");
    const targetType = await createTestCardType(target.id, "Bug", "Bug", "#000000");
    const sharedSource = await db.label.create({ data: { projectId: source.id, name: "frontend", color: "#111111" } });
    const sharedTarget = await db.label.create({ data: { projectId: target.id, name: "frontend", color: "#222222" } });
    const onlySource = await db.label.create({
      data: { projectId: source.id, name: "content", color: "#333333", description: "Copy" },
    });
    const global = await db.label.create({ data: { name: `global-${Date.now()}`, color: "#444444" } });
    const card = await createTestCard(source.id, sourceTodo);
    await db.card.update({
      where: { id: card.id },
      data: {
        typeId: sourceType.id,
        labels: { create: [{ labelId: sharedSource.id }, { labelId: onlySource.id }, { labelId: global.id }] },
      },
    });

    await moveCardToProject(card.id, target.id, userId);

    const moved = await db.card.findUniqueOrThrow({ where: { id: card.id }, include: { labels: { include: { label: true } } } });
    expect(moved.typeId).toBe(targetType.id);
    const created = await db.label.findFirstOrThrow({ where: { projectId: target.id, name: "content" } });
    expect(created).toMatchObject({ color: "#333333", description: "Copy", userId: null });
    expect(moved.labels.map((l) => l.labelId).sort()).toEqual([sharedTarget.id, created.id, global.id].sort());
    await db.label.delete({ where: { id: global.id } });
  });

  it("creates a missing card type in the target project", async () => {
    const sourceType = await createTestCardType(source.id, "Spike", "Flask", "#123456");
    const card = await createTestCard(source.id, sourceTodo);
    await db.card.update({ where: { id: card.id }, data: { typeId: sourceType.id } });

    await moveCardToProject(card.id, target.id, userId);

    const moved = await db.card.findUniqueOrThrow({ where: { id: card.id }, include: { type: true } });
    expect(moved.type).toMatchObject({ projectId: target.id, name: "Spike", icon: "Flask", color: "#123456" });
  });

  it("removes assignees who can't access the target project", async () => {
    const stamp = Date.now();
    const kept = (await createTestUser(`transfer-kept-${stamp}`)).user;
    const dropped = (await createTestUser(`transfer-dropped-${stamp}`)).user;
    await db.projectMember.createMany({
      data: [
        { projectId: source.id, userId: kept.id, role: "MEMBER" },
        { projectId: source.id, userId: dropped.id, role: "MEMBER" },
        { projectId: target.id, userId: kept.id, role: "MEMBER" },
      ],
    });
    const card = await createTestCard(source.id, sourceTodo);
    await db.cardAssignee.createMany({ data: [{ cardId: card.id, userId: kept.id }, { cardId: card.id, userId: dropped.id }] });

    await moveCardToProject(card.id, target.id, userId);

    const assignees = await db.cardAssignee.findMany({ where: { cardId: card.id } });
    expect(assignees.map((a) => a.userId)).toEqual([kept.id]);
    const unassigned = await db.activity.findFirstOrThrow({ where: { cardId: card.id, type: "unassigned" } });
    expect(unassigned.fromValue).toBe(dropped.name);
    await cleanupTestUser(kept.id);
    await cleanupTestUser(dropped.id);
  });

  it("falls back to the state group, then honours an explicit column", async () => {
    const review = await createGroupedColumn(source.id, "Review", 2, "STARTED");
    const doing = await createGroupedColumn(target.id, "Doing", 2, "STARTED");
    const first = await createTestCard(source.id, review.id, "By group");
    const second = await createTestCard(source.id, sourceTodo, "Explicit");

    await moveCardToProject(first.id, target.id, userId);
    await moveCardToProject(second.id, target.id, userId, { columnId: targetDone });

    expect((await db.card.findUniqueOrThrow({ where: { id: first.id } })).columnId).toBe(doing.id);
    const explicit = await db.card.findUniqueOrThrow({ where: { id: second.id } });
    expect(explicit.columnId).toBe(targetDone);
    expect(explicit.completedAt).not.toBeNull();
  });

  it("refuses a column from another project, a subtask, and the card's own project, changing nothing", async () => {
    const parent = await createTestCard(source.id, sourceTodo, "Parent");
    const child = await createTestCard(source.id, sourceTodo, "Child");
    await db.card.update({ where: { id: child.id }, data: { parentId: parent.id } });

    const wrongColumn = await moveCardToProject(parent.id, target.id, userId, { columnId: sourceTodo });
    const subtask = await moveCardToProject(child.id, target.id, userId);
    const sameProject = await moveCardToProject(parent.id, source.id, userId);

    expect([wrongColumn, subtask, sameProject].map((r) => !r.success && r.kind)).toEqual(["invalid", "invalid", "invalid"]);
    expect(await db.card.count({ where: { projectId: source.id } })).toBe(2);
    expect(await db.activity.count({ where: { cardId: { in: [parent.id, child.id] } } })).toBe(0);
  });

  it("requires MEMBER on the target project", async () => {
    const owner = (await createTestUser(`transfer-owner-${Date.now()}`)).user;
    const foreign = await createTestProject(owner.id, "Foreign");
    await createGroupedColumn(foreign.id, "Todo", 0, "UNSTARTED");
    await db.projectMember.create({ data: { projectId: foreign.id, userId, role: "VIEWER" } });
    const card = await createTestCard(source.id, sourceTodo);

    const res = await moveCardToProject(card.id, foreign.id, userId);

    expect(!res.success && res.kind).toBe("forbidden");
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).projectId).toBe(source.id);
    await cleanupTestUser(owner.id);
  });

  it("resolves an old identifier, including across two moves", async () => {
    const third = await createTestProject(userId, "Transfer Third", uniqueKey("H"));
    await createGroupedColumn(third.id, "Todo", 0, "UNSTARTED");
    const card = await createTestCard(source.id, sourceTodo, "Traveller");

    await moveCardToProject(card.id, target.id, userId);
    await moveCardToProject(card.id, third.id, userId);

    for (const identifier of [`${source.key}-1`, `${target.key}-1`, `${third.key}-1`]) {
      const res = await getCardByIdentifier(identifier, userId);
      expect(res.data?.id).toBe(card.id);
      expect(res.data?.identifier).toBe(`${third.key}-1`);
    }
  });

  it("resolves an old identifier only through projects the caller can see", async () => {
    const other = (await createTestUser(`transfer-other-${Date.now()}`)).user;
    const otherSource = await createTestProject(other.id, "Other Source", source.key);
    const otherTarget = await createTestProject(other.id, "Other Target", uniqueKey("O"));
    const otherColumn = (await createGroupedColumn(otherSource.id, "Todo", 0, "UNSTARTED")).id;
    await createGroupedColumn(otherTarget.id, "Todo", 0, "UNSTARTED");
    const mine = await createTestCard(source.id, sourceTodo, "Mine");
    const theirs = await createTestCard(otherSource.id, otherColumn, "Theirs");

    await moveCardToProject(mine.id, target.id, userId);
    await moveCardToProject(theirs.id, otherTarget.id, other.id);

    expect((await getCardByIdentifier(`${source.key}-1`, userId)).data?.id).toBe(mine.id);
    expect((await getCardByIdentifier(`${source.key}-1`, other.id)).data?.id).toBe(theirs.id);
    await cleanupTestUser(other.id);
  });

  it("prefers a live card over a moved one with the same old identifier", async () => {
    const card = await createTestCard(source.id, sourceTodo, "Moved away");
    await moveCardToProject(card.id, target.id, userId);
    const reused = await createTestCard(source.id, sourceTodo, "Reuses number 1");

    const res = await getCardByIdentifier(`${source.key}-1`, userId);

    expect(res.data?.id).toBe(reused.id);
  });
});
