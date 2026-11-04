import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import {
  getProjectMembers,
  addProjectMember,
  updateMemberRole,
  removeProjectMember,
} from "../members";
import { createSession, destroySession } from "@/lib/auth";

describe("Project Members Server Actions", () => {
  let ownerId: string;
  let ownerEmail: string;
  let memberId: string;
  let memberEmail: string;
  let outsiderId: string;
  let outsiderEmail: string;
  let projectId: string;

  beforeEach(async () => {
    const u1 = await createTestUser(`mem-owner-${Date.now()}`);
    const u2 = await createTestUser(`mem-user-${Date.now()}`);
    const u3 = await createTestUser(`mem-outsider-${Date.now()}`);

    ownerId = u1.user.id;
    ownerEmail = u1.user.email;
    memberId = u2.user.id;
    memberEmail = u2.user.email;
    outsiderId = u3.user.id;
    outsiderEmail = u3.user.email;

    const project = await createTestProject(ownerId, "Membership Project");
    projectId = project.id;

    // Add owner to members table
    await db.projectMember.create({
      data: {
        projectId,
        userId: ownerId,
        role: "OWNER",
      },
    });

    await createSession({ userId: ownerId, email: ownerEmail, name: "Owner" });
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(ownerId);
    await cleanupTestUser(memberId);
    await cleanupTestUser(outsiderId);
  });

  it("lists project members", async () => {
    const res = await getProjectMembers(projectId);
    expect(res.success).toBe(true);
    expect(res.data?.length).toBe(1);
    expect(res.data?.[0].userId).toBe(ownerId);
    expect(res.data?.[0].role).toBe("OWNER");
  });

  it("allows owner to add an existing registered user as member", async () => {
    const res = await addProjectMember(projectId, memberEmail, "MEMBER");
    expect(res.success).toBe(true);
    expect(res.data?.userId).toBe(memberId);
    expect(res.data?.role).toBe("MEMBER");

    const listRes = await getProjectMembers(projectId);
    expect(listRes.data?.length).toBe(2);
  });

  it("fails to add a non-existent email", async () => {
    const res = await addProjectMember(projectId, "nobody@nowhere-random.com", "MEMBER");
    expect(res.success).toBe(false);
    expect(res.error).toBe("No user found with that email address");
  });

  it("updates member role", async () => {
    await addProjectMember(projectId, memberEmail, "MEMBER");

    const updateRes = await updateMemberRole(projectId, memberId, "ADMIN");
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.role).toBe("ADMIN");
  });

  it("removes a member from the project", async () => {
    await addProjectMember(projectId, memberEmail, "MEMBER");

    const removeRes = await removeProjectMember(projectId, memberId);
    expect(removeRes.success).toBe(true);

    const listRes = await getProjectMembers(projectId);
    expect(listRes.data?.length).toBe(1);
  });

  it("prevents non-members from adding members", async () => {
    await createSession({ userId: outsiderId, email: outsiderEmail, name: "Outsider" });

    const res = await addProjectMember(projectId, memberEmail, "MEMBER");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Only project admins and owners");
  });

  it("ignores a client-supplied user id and acts as the session user", async () => {
    await createSession({ userId: outsiderId, email: outsiderEmail, name: "Outsider" });
    const addAsOwner = addProjectMember as (...args: unknown[]) => ReturnType<typeof addProjectMember>;

    const res = await addAsOwner(projectId, outsiderEmail, "OWNER", ownerId);
    expect(res.success).toBe(false);
    expect(
      await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: outsiderId } } })
    ).toBeNull();
  });

  describe("changing a secondary owner's role", () => {
    let adminId: string;
    let adminEmail: string;

    beforeEach(async () => {
      const admin = await createTestUser(`mem-admin-${Date.now()}`);
      adminId = admin.user.id;
      adminEmail = admin.user.email;
      await db.projectMember.createMany({
        data: [
          { projectId, userId: adminId, role: "ADMIN" },
          { projectId, userId: memberId, role: "OWNER" },
        ],
      });
    });

    afterEach(async () => {
      await cleanupTestUser(adminId);
    });

    const storedRole = async (userId: string) =>
      (await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }))?.role;

    it("refuses an ADMIN and leaves the row unchanged", async () => {
      await createSession({ userId: adminId, email: adminEmail, name: "Admin" });

      const res = await updateMemberRole(projectId, memberId, "VIEWER");

      expect(res.success).toBe(false);
      expect(res.error).toContain("Only the project owner");
      expect(await storedRole(memberId)).toBe("OWNER");
    });

    it("still lets an owner change it", async () => {
      const res = await updateMemberRole(projectId, memberId, "VIEWER");

      expect(res.success).toBe(true);
      expect(await storedRole(memberId)).toBe("VIEWER");
    });

    it("still lets an ADMIN change a regular member", async () => {
      await db.projectMember.update({
        where: { projectId_userId: { projectId, userId: memberId } },
        data: { role: "MEMBER" },
      });
      await createSession({ userId: adminId, email: adminEmail, name: "Admin" });

      const res = await updateMemberRole(projectId, memberId, "VIEWER");

      expect(res.success).toBe(true);
      expect(await storedRole(memberId)).toBe("VIEWER");
    });
  });

  it("rejects a role outside the four project roles", async () => {
    await addProjectMember(projectId, memberEmail, "MEMBER");

    const updateRes = await updateMemberRole(projectId, memberId, "SUPERUSER" as never);
    expect(updateRes.success).toBe(false);
    expect(
      (await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: memberId } } }))?.role
    ).toBe("MEMBER");

    const addRes = await addProjectMember(projectId, outsiderEmail, "SUPERUSER" as never);
    expect(addRes.success).toBe(false);
    expect(
      await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: outsiderId } } })
    ).toBeNull();
  });

  it("reports a missing member instead of a generic failure", async () => {
    const res = await updateMemberRole(projectId, outsiderId, "VIEWER");
    expect(res).toEqual({ success: false, error: "Member not found in project" });
  });
});
