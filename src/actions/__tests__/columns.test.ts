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

  it("deletes a column", async () => {
    const colRes = await createColumn(projectId, "To Delete");
    const colId = colRes.data!.id;

    const deleteRes = await deleteColumn(colId);
    expect(deleteRes.success).toBe(true);

    const projectDetails = await getProjectById(projectId);
    expect(projectDetails.data!.columns.some((c) => c.id === colId)).toBe(false);
  });
});
