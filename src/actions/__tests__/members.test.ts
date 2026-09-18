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
});
