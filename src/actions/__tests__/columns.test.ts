import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createColumn, updateColumn, reorderColumns, deleteColumn } from "../columns";
import { createProject, getProjectById } from "../projects";
import { createTestUser, cleanupTestUser, createTestCard } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { GROUP_CONFLICTS_WITH_IS_DONE_ERROR } from "@/lib/columnGroups";

describe("Columns Server Actions", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`columns-action-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Column Test Project" });
    projectId = pRes.data!.id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("creates a new column in project", async () => {
    const res = await createColumn(projectId, "Review");
    expect(res.success).toBe(true);
    expect(res.data?.name).toBe("Review");
    expect(res.data?.order).toBe(4); // 4 initial columns (0..3) + 1 = 4
  });

  it("validates empty column name", async () => {
    const res = await createColumn(projectId, "   ");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Column name is required");
  });

  it("updates and reorders columns", async () => {
    const colRes = await createColumn(projectId, "QA");
    const colId = colRes.data!.id;

    const updateRes = await updateColumn(colId, { name: "Quality Assurance" });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Quality Assurance");

    const projectDetails = await getProjectById(projectId);
    const existingColIds = projectDetails.data!.columns.map((c) => c.id);
    const reversedIds = [...existingColIds].reverse();

    const reorderRes = await reorderColumns(projectId, reversedIds);
    expect(reorderRes.success).toBe(true);

    const reorderedProject = await getProjectById(projectId);
    expect(reorderedProject.data!.columns[0].id).toBe(reversedIds[0]);
  });

  it("creates column with isDone flag and updates isDone status", async () => {
    const colRes = await createColumn(projectId, "Shipped", { isDone: true });
    expect(colRes.success).toBe(true);
    expect(colRes.data?.isDone).toBe(true);

    const updateRes = await updateColumn(colRes.data!.id, { isDone: false });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.isDone).toBe(false);
  });

  it("gives a new project's default columns their state groups", async () => {
    const project = await getProjectById(projectId);
    const groups = Object.fromEntries(project.data!.columns.map((c) => [c.name, [c.group, c.isDone]]));
    expect(groups).toEqual({
      Backlog: ["BACKLOG", false],
      "To Do": ["UNSTARTED", false],
      "In Progress": ["STARTED", false],
      Done: ["COMPLETED", true],
    });
  });

  it("creates a cancelled column that is closed but not done", async () => {
    const res = await createColumn(projectId, "Won't Do", { group: "CANCELLED" });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ group: "CANCELLED", isDone: false });
  });

  it("clears completedAt when a completed column becomes cancelled", async () => {
    const col = (await createColumn(projectId, "Shipped", { group: "COMPLETED" })).data!;
    const card = await createTestCard(projectId, col.id);
    await db.card.update({ where: { id: card.id }, data: { completedAt: new Date() } });

    const res = await updateColumn(col.id, { group: "CANCELLED" });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ group: "CANCELLED", isDone: false });

    const after = await db.card.findUnique({ where: { id: card.id } });
    expect(after?.completedAt).toBeNull();
  });

  it("sets completedAt when a column moves into the completed group", async () => {
    const col = (await createColumn(projectId, "Review", { group: "STARTED" })).data!;
    const card = await createTestCard(projectId, col.id);

    const res = await updateColumn(col.id, { group: "COMPLETED" });
    expect(res.data).toMatchObject({ group: "COMPLETED", isDone: true });

    const after = await db.card.findUnique({ where: { id: card.id } });
    expect(after?.completedAt).not.toBeNull();
  });

  it("rejects an isDone that contradicts the group", async () => {
    const res = await createColumn(projectId, "Odd", { group: "CANCELLED", isDone: true });
    expect(res.success).toBe(false);
    expect(res.error).toBe(GROUP_CONFLICTS_WITH_IS_DONE_ERROR);
  });

  it("stores, validates and clears a column's color and description", async () => {
    const col = (await createColumn(projectId, "Design", { color: "#ec4899", description: "Mockups go here" })).data!;
    expect(col).toMatchObject({ color: "#ec4899", description: "Mockups go here" });

    const bad = await updateColumn(col.id, { color: "pink" });
    expect(bad).toEqual({ success: false, error: "Color must be a hex value like #6366f1" });

    const blankName = await updateColumn(col.id, { name: "   " });
    expect(blankName).toEqual({ success: false, error: "Column name is required" });

    const cleared = await updateColumn(col.id, { color: null, description: null });
    expect(cleared.data).toMatchObject({ color: null, description: null, group: "UNSTARTED" });
  });

  it("deletes a column", async () => {
    const colRes = await createColumn(projectId, "To Delete");
    const colId = colRes.data!.id;

    const deleteRes = await deleteColumn(colId);
    expect(deleteRes.success).toBe(true);

    const projectDetails = await getProjectById(projectId);
    expect(projectDetails.data!.columns.some((c) => c.id === colId)).toBe(false);
  });

  it("refuses to delete a project's last column", async () => {
    const columnIds = (await getProjectById(projectId)).data!.columns.map((c) => c.id);
    for (const id of columnIds.slice(1)) {
      expect((await deleteColumn(id)).success).toBe(true);
    }

    const res = await deleteColumn(columnIds[0]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/at least one column/);
    expect((await getProjectById(projectId)).data!.columns.map((c) => c.id)).toEqual([columnIds[0]]);
  });

  it("rejects a reorder that includes another project's column", async () => {
    const otherProject = await createProject({ name: "Other Project" });
    const otherColumnId = (await getProjectById(otherProject.data!.id)).data!.columns[0].id;
    const ownIds = (await getProjectById(projectId)).data!.columns.map((c) => c.id);

    const res = await reorderColumns(projectId, [otherColumnId, ...ownIds]);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid column");

    const otherAfter = await getProjectById(otherProject.data!.id);
    expect(otherAfter.data!.columns[0].id).toBe(otherColumnId);
    expect(otherAfter.data!.columns[0].order).toBe(0);
    expect((await getProjectById(projectId)).data!.columns.map((c) => c.id)).toEqual(ownIds);
  });

  it("rejects a reorder with duplicate column ids", async () => {
    const ownIds = (await getProjectById(projectId)).data!.columns.map((c) => c.id);

    const res = await reorderColumns(projectId, [ownIds[0], ownIds[0], ...ownIds.slice(1)]);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid column");
  });
});

