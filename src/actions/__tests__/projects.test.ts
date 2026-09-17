import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as projectActions from "../projects";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  archiveProject,
  unarchiveProject,
  deleteProject,
} from "../projects";
import { generateProjectKey } from "@/lib/projectKey";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";

describe("Projects Server Actions", () => {
  it("does not expose generateProjectKey as a Server Action", () => {
    expect((projectActions as Record<string, unknown>).generateProjectKey).toBeUndefined();
  });


  let userId: string;
  let userEmail: string;
  let userName: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`projects-action-${Date.now()}`);
    userId = user.id;
    userEmail = user.email;
    userName = user.name;
    await createSession({ userId, email: userEmail, name: userName });
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("requires authorization for project operations", async () => {
    await destroySession();
    const res = await getProjects();
    expect(res.success).toBe(false);
    expect(res.error).toBe("Unauthorized");
  });

  it("creates a new project with default Kanban columns", async () => {
    const res = await createProject({
      name: "Alpha Project",
      description: "Sample Description",
      color: "#10b981",
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data?.name).toBe("Alpha Project");

    const fetchRes = await getProjectById(res.data!.id);
    expect(fetchRes.success).toBe(true);
    expect(fetchRes.data?.columns.length).toBe(4);
    const columnNames = fetchRes.data?.columns.map((c) => c.name);
    expect(columnNames).toEqual(["Backlog", "To Do", "In Progress", "Done"]);
  });

  it("validates empty project name on creation", async () => {
    const res = await createProject({ name: "   " });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Project name is required");
  });

  it("fetches user projects list", async () => {
    await createProject({ name: "P1" });
    await createProject({ name: "P2" });

    const list = await getProjects(false);
    expect(list.success).toBe(true);
    expect(list.data?.length).toBeGreaterThanOrEqual(2);
  });

  it("updates, archives, unarchives, and deletes a project", async () => {
    const createRes = await createProject({ name: "Lifecycle Project" });
    const projectId = createRes.data!.id;

    // Update
    const updateRes = await updateProject(projectId, { name: "Updated Name", color: "#ef4444" });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Updated Name");

    // Archive
    const archiveRes = await archiveProject(projectId);
    expect(archiveRes.success).toBe(true);
    expect(archiveRes.data?.isArchived).toBe(true);

    // Unarchive
    const unarchiveRes = await unarchiveProject(projectId);
    expect(unarchiveRes.success).toBe(true);
    expect(unarchiveRes.data?.isArchived).toBe(false);

    // Delete
    const deleteRes = await deleteProject(projectId);
    expect(deleteRes.success).toBe(true);

    const getRes = await getProjectById(projectId);
    expect(getRes.success).toBe(false);
  });

  it("de-duplicates auto-generated project keys for the same user", async () => {
    const first = await createProject({ name: "Alpha Beta" });
    const second = await createProject({ name: "Amazing Bicycle" });
    const third = await createProject({ name: "Another Boat" });

    expect(first.data?.key).toBe("AB");
    expect(second.data?.key).toBe("AB2");
    expect(third.data?.key).toBe("AB3");
  });

  it("falls back to a name-derived key when a requested key sanitizes to empty", async () => {
    const res = await createProject({ name: "Dashes Only Project", key: "---" });
    expect(res.success).toBe(true);
    expect(res.data?.key).toBe("DOP");
  });

  it("rejects a duplicate key at the database level even if the app-level check is bypassed", async () => {
    const first = await createProject({ name: "Collision One", key: "DUP" });
    expect(first.data?.key).toBe("DUP");

    await expect(
      db.project.create({
        data: { userId, name: "Collision Two", key: "DUP" },
      })
    ).rejects.toThrow();
  });

  it("allows two different users to independently use the same project key", async () => {
    const { user: otherUser } = await createTestUser(`projects-action-other-${Date.now()}`);
    try {
      const mineKey = await generateProjectKey("Shared Name", undefined, userId);
      const theirsKey = await generateProjectKey("Shared Name", undefined, otherUser.id);
      expect(mineKey).toBe(theirsKey);

      const mine = await db.project.create({ data: { userId, name: "Shared Name", key: mineKey } });
      const theirs = await db.project.create({ data: { userId: otherUser.id, name: "Shared Name", key: theirsKey } });
      expect(mine.key).toBe(theirs.key);
    } finally {
      await cleanupTestUser(otherUser.id);
    }
  });
});
