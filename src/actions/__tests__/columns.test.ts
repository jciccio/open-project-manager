import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createColumn, updateColumn, reorderColumns, deleteColumn } from "../columns";
import { createProject, getProjectById } from "../projects";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";

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
    const colRes = await createColumn(projectId, "Shipped", true);
    expect(colRes.success).toBe(true);
    expect(colRes.data?.isDone).toBe(true);

    const updateRes = await updateColumn(colRes.data!.id, { isDone: false });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.isDone).toBe(false);
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

