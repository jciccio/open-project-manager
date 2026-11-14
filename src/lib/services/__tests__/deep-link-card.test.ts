import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";
import { getCardByProjectAndParam } from "../cards";

describe("getCardByProjectAndParam", () => {
  let ownerId: string;
  let viewerId: string;
  let outsiderId: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    ownerId = (await createTestUser(`dl-owner-${stamp}`)).user.id;
    viewerId = (await createTestUser(`dl-viewer-${stamp}`)).user.id;
    outsiderId = (await createTestUser(`dl-outsider-${stamp}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(viewerId);
    await cleanupTestUser(outsiderId);
  });

  it("enforces VIEWER access and project scoping", async () => {
    const projectA = await createTestProject(ownerId, "Project Alpha", "ALPHA");
    const projectB = await createTestProject(ownerId, "Project Beta", "BETA");
    const colA = await createTestColumn(projectA.id, "To Do", 0);
    const colB = await createTestColumn(projectB.id, "To Do", 0);

    await db.projectMember.create({
      data: { projectId: projectA.id, userId: viewerId, role: "VIEWER" },
    });

    const cardA = await db.card.create({
      data: { projectId: projectA.id, columnId: colA.id, title: "Alpha Card", number: 1, order: 1000 },
    });
    const cardB = await db.card.create({
      data: { projectId: projectB.id, columnId: colB.id, title: "Beta Card", number: 1, order: 1000 },
    });

    // Outsider denied on private project
    const outsiderRes = await getCardByProjectAndParam(projectA.id, "ALPHA-1", outsiderId);
    expect(outsiderRes.success).toBe(false);
    expect(outsiderRes.kind).toBe("forbidden");

    // Viewer allowed
    const viewerRes = await getCardByProjectAndParam(projectA.id, "ALPHA-1", viewerId);
    expect(viewerRes.success).toBe(true);
    expect(viewerRes.data?.id).toBe(cardA.id);

    // Scoped to projectId: BETA-1 cannot be fetched under project A, nor cardB.id under project A
    const crossKey = await getCardByProjectAndParam(projectA.id, "BETA-1", ownerId);
    expect(crossKey.success).toBe(false);
    expect(crossKey.kind).toBe("not_found");

    const crossId = await getCardByProjectAndParam(projectA.id, cardB.id, ownerId);
    expect(crossId.success).toBe(false);
    expect(crossId.kind).toBe("not_found");

    // Supports bare number, #NNN, and ID
    expect((await getCardByProjectAndParam(projectA.id, "1", viewerId)).data?.id).toBe(cardA.id);
    expect((await getCardByProjectAndParam(projectA.id, "#1", viewerId)).data?.id).toBe(cardA.id);
    expect((await getCardByProjectAndParam(projectA.id, cardA.id, viewerId)).data?.id).toBe(cardA.id);
  });

  it("loads archived cards with active children and child column.isDone state while omitting archived children", async () => {
    const project = await createTestProject(ownerId, "Archive Scope", "ARC");
    const todoCol = await createTestColumn(project.id, "To Do", 0);
    const doneCol = await db.column.create({
      data: { projectId: project.id, name: "Done", order: 1, isDone: true, group: "COMPLETED" },
    });

    const parent = await db.card.create({
      data: {
        projectId: project.id,
        columnId: todoCol.id,
        title: "Archived Parent",
        number: 5,
        order: 1000,
        isArchived: true,
      },
    });

    const activeChildInDoneCol = await db.card.create({
      data: {
        projectId: project.id,
        columnId: doneCol.id,
        parentId: parent.id,
        title: "Active Done Child",
        number: 6,
        order: 1000,
        isArchived: false,
        completedAt: null,
      },
    });

    await db.card.create({
      data: {
        projectId: project.id,
        columnId: todoCol.id,
        parentId: parent.id,
        title: "Archived Child",
        number: 7,
        order: 2000,
        isArchived: true,
      },
    });

    const res = await getCardByProjectAndParam(project.id, "ARC-5", ownerId);
    expect(res.success).toBe(true);
    expect(res.data?.id).toBe(parent.id);
    expect(res.data?.isArchived).toBe(true);
    expect(res.data?.children).toHaveLength(1);
    expect(res.data?.children[0]).toMatchObject({
      id: activeChildInDoneCol.id,
      title: "Active Done Child",
      column: { id: doneCol.id, isDone: true },
    });
  });
});
