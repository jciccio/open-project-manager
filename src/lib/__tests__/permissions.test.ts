import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import {
  getProjectAccess,
  verifyProjectAccess,
  canViewProject,
  canEditProject,
  canAdminProject,
  isProjectOwner,
} from "../permissions";

describe("Permissions Module", () => {
  let ownerId: string;
  let adminId: string;
  let memberId: string;
  let viewerId: string;
  let outsiderId: string;
  let privateProjectId: string;
  let internalProjectId: string;

  beforeEach(async () => {
    const u1 = await createTestUser(`owner-${Date.now()}`);
    const u2 = await createTestUser(`admin-${Date.now()}`);
    const u3 = await createTestUser(`member-${Date.now()}`);
    const u4 = await createTestUser(`viewer-${Date.now()}`);
    const u5 = await createTestUser(`outsider-${Date.now()}`);

    ownerId = u1.user.id;
    adminId = u2.user.id;
    memberId = u3.user.id;
    viewerId = u4.user.id;
    outsiderId = u5.user.id;

    const privProj = await createTestProject(ownerId, "Private Proj");
    privateProjectId = privProj.id;

    const intProj = await db.project.create({
      data: {
        userId: ownerId,
        name: "Internal Proj",
        key: "INT",
        visibility: "INTERNAL",
      },
    });
    internalProjectId = intProj.id;

    // Add members to private project
    await db.projectMember.createMany({
      data: [
        { projectId: privateProjectId, userId: ownerId, role: "OWNER" },
        { projectId: privateProjectId, userId: adminId, role: "ADMIN" },
        { projectId: privateProjectId, userId: memberId, role: "MEMBER" },
        { projectId: privateProjectId, userId: viewerId, role: "VIEWER" },
      ],
    });
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(adminId);
    await cleanupTestUser(memberId);
    await cleanupTestUser(viewerId);
    await cleanupTestUser(outsiderId);
  });

  it("identifies owner with full access", async () => {
    const access = await getProjectAccess(privateProjectId, ownerId);
    expect(access.hasAccess).toBe(true);
    expect(access.role).toBe("OWNER");
    expect(access.isOwner).toBe(true);
    expect(access.isAdmin).toBe(true);
    expect(access.canEdit).toBe(true);

    expect(await isProjectOwner(privateProjectId, ownerId)).toBe(true);
    expect(await canAdminProject(privateProjectId, ownerId)).toBe(true);
    expect(await canEditProject(privateProjectId, ownerId)).toBe(true);
    expect(await canViewProject(privateProjectId, ownerId)).toBe(true);
  });

  it("identifies admin with admin and edit rights, but not owner", async () => {
    const access = await getProjectAccess(privateProjectId, adminId);
    expect(access.hasAccess).toBe(true);
    expect(access.role).toBe("ADMIN");
    expect(access.isOwner).toBe(false);
    expect(access.isAdmin).toBe(true);
    expect(access.canEdit).toBe(true);

    expect(await isProjectOwner(privateProjectId, adminId)).toBe(false);
    expect(await canAdminProject(privateProjectId, adminId)).toBe(true);
    expect(await canEditProject(privateProjectId, adminId)).toBe(true);
    expect(await canViewProject(privateProjectId, adminId)).toBe(true);
  });

  it("identifies member with edit rights, but not admin or owner", async () => {
    const access = await getProjectAccess(privateProjectId, memberId);
    expect(access.hasAccess).toBe(true);
    expect(access.role).toBe("MEMBER");
    expect(access.isOwner).toBe(false);
    expect(access.isAdmin).toBe(false);
    expect(access.canEdit).toBe(true);

    expect(await isProjectOwner(privateProjectId, memberId)).toBe(false);
    expect(await canAdminProject(privateProjectId, memberId)).toBe(false);
    expect(await canEditProject(privateProjectId, memberId)).toBe(true);
    expect(await canViewProject(privateProjectId, memberId)).toBe(true);
  });

  it("identifies viewer with read-only rights", async () => {
    const access = await getProjectAccess(privateProjectId, viewerId);
    expect(access.hasAccess).toBe(true);
    expect(access.role).toBe("VIEWER");
    expect(access.isOwner).toBe(false);
    expect(access.isAdmin).toBe(false);
    expect(access.canEdit).toBe(false);

    expect(await isProjectOwner(privateProjectId, viewerId)).toBe(false);
    expect(await canAdminProject(privateProjectId, viewerId)).toBe(false);
    expect(await canEditProject(privateProjectId, viewerId)).toBe(false);
    expect(await canViewProject(privateProjectId, viewerId)).toBe(true);
  });

  it("denies outsider access to private project", async () => {
    const access = await getProjectAccess(privateProjectId, outsiderId);
    expect(access.hasAccess).toBe(false);
    expect(access.role).toBeNull();

    expect(await canViewProject(privateProjectId, outsiderId)).toBe(false);
    expect(await canEditProject(privateProjectId, outsiderId)).toBe(false);
  });

  it("grants read-only viewer access to internal project for non-members", async () => {
    const access = await getProjectAccess(internalProjectId, outsiderId);
    expect(access.hasAccess).toBe(true);
    expect(access.role).toBe("VIEWER");
    expect(access.canEdit).toBe(false);

    expect(await canViewProject(internalProjectId, outsiderId)).toBe(true);
    expect(await canEditProject(internalProjectId, outsiderId)).toBe(false);
  });

  it("handles non-existent project gracefully", async () => {
    const access = await getProjectAccess("non-existent-proj-id", ownerId);
    expect(access.hasAccess).toBe(false);
    expect(access.error).toBe("Project not found");
  });
});
