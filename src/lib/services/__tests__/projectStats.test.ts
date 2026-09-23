import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestUser,
  createTestProject,
  createTestColumn,
  createTestCard,
  cleanupTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";
import { getProjectStats, startOfUtcToday } from "@/lib/services/projectStats";

const NOW = new Date("2026-09-20T12:00:00Z");

describe("getProjectStats", () => {
  let userId: string;
  let otherUserId: string;
  let projectId: string;
  let emptyProjectId: string;
  let todoColumnId: string;
  let doneColumnId: string;
  let misnamedDoneColumnId: string;

  async function addCard(columnId: string, data: { dueDate?: Date; isArchived?: boolean } = {}) {
    const card = await createTestCard(projectId, columnId);
    return db.card.update({ where: { id: card.id }, data });
  }

  beforeEach(async () => {
    userId = (await createTestUser(`stats-${Date.now()}`)).user.id;
    otherUserId = (await createTestUser(`stats-other-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Stats Project")).id;
    emptyProjectId = (await createTestProject(userId, "Empty Project")).id;

    todoColumnId = (await createTestColumn(projectId, "To Do", 0)).id;
    doneColumnId = (await db.column.create({ data: { projectId, name: "Shipped", order: 1, isDone: true } })).id;
    misnamedDoneColumnId = (await createTestColumn(projectId, "Done", 2)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
    await cleanupTestUser(otherUserId);
  });

  it("counts done cards by the column isDone flag, not the column name", async () => {
    await addCard(todoColumnId);
    await addCard(doneColumnId);
    await addCard(doneColumnId);
    await addCard(misnamedDoneColumnId);

    const stats = (await getProjectStats([projectId], userId, NOW))[projectId];

    expect(stats.total).toBe(4);
    expect(stats.done).toBe(2);
    expect(stats.open).toBe(2);
    expect(stats.percentComplete).toBe(50);
  });

  it("excludes archived cards from totals and reports them separately", async () => {
    await addCard(todoColumnId);
    await addCard(todoColumnId, { isArchived: true });
    await addCard(doneColumnId, { isArchived: true });

    const stats = (await getProjectStats([projectId], userId, NOW))[projectId];

    expect(stats.total).toBe(1);
    expect(stats.done).toBe(0);
    expect(stats.archived).toBe(2);
  });

  it("counts only open, unarchived cards due before today (UTC) as overdue", async () => {
    await addCard(todoColumnId, { dueDate: new Date("2026-09-19T00:00:00Z") });
    await addCard(todoColumnId, { dueDate: new Date("2026-09-20T00:00:00Z") });
    await addCard(todoColumnId, { dueDate: new Date("2026-09-21T00:00:00Z") });
    await addCard(todoColumnId);
    await addCard(doneColumnId, { dueDate: new Date("2026-09-01T00:00:00Z") });
    await addCard(todoColumnId, { dueDate: new Date("2026-09-01T00:00:00Z"), isArchived: true });

    const stats = (await getProjectStats([projectId], userId, NOW))[projectId];

    expect(stats.overdue).toBe(1);
  });

  it("returns zeros and a null percentage for a project with no cards", async () => {
    const stats = (await getProjectStats([emptyProjectId], userId, NOW))[emptyProjectId];

    expect(stats).toEqual({ total: 0, done: 0, open: 0, overdue: 0, archived: 0, percentComplete: null });
  });

  it("does not count cards in projects the user cannot access", async () => {
    await addCard(todoColumnId);

    const stats = (await getProjectStats([projectId], otherUserId, NOW))[projectId];

    expect(stats.total).toBe(0);
  });

  it("returns an empty map for an empty id list", async () => {
    expect(await getProjectStats([], userId, NOW)).toEqual({});
  });
});

describe("startOfUtcToday", () => {
  it("returns UTC midnight of the given instant", () => {
    expect(startOfUtcToday(new Date("2026-09-20T23:59:59Z")).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(startOfUtcToday(new Date("2026-09-20T00:00:00Z")).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });
});
