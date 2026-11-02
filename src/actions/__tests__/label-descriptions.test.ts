import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLabel, getLabels, updateLabel } from "../labels";
import { createProject } from "../projects";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";

describe("Label descriptions", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`label-descriptions-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });
    projectId = (await createProject({ name: "Label Descriptions Project" })).data!.id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("stores a description on create and returns it from getLabels", async () => {
    const created = await createLabel("Blocked", "#eb144c", projectId, "  Waiting on a human. Do not pick up.  ");
    expect(created.success).toBe(true);
    expect(created.data?.description).toBe("Waiting on a human. Do not pick up.");

    const listed = await getLabels(projectId);
    expect(listed.data?.find((l) => l.id === created.data!.id)?.description).toBe("Waiting on a human. Do not pick up.");
  });

  it("stores no description when none or only whitespace is given", async () => {
    expect((await createLabel("Plain", "#3b82f6")).data?.description).toBeNull();
    expect((await createLabel("Blank", "#3b82f6", undefined, "   ")).data?.description).toBeNull();
  });

  it("updates color and description, and clears the description with an empty string", async () => {
    const label = (await createLabel("Dev Log", "#3b82f6", projectId)).data!;

    const updated = await updateLabel(label.id, { color: "#10b981", description: "Publish weekly" });
    expect(updated.success).toBe(true);
    expect(updated.data).toMatchObject({ name: "Dev Log", color: "#10b981", description: "Publish weekly" });

    const colorOnly = await updateLabel(label.id, { color: "#f59e0b" });
    expect(colorOnly.data).toMatchObject({ color: "#f59e0b", description: "Publish weekly" });

    const cleared = await updateLabel(label.id, { description: "" });
    expect(cleared.data).toMatchObject({ color: "#f59e0b", description: null });
  });

  it("rejects a non-hex color and an over-long description", async () => {
    const badCreate = await createLabel("Bad", "red");
    expect(badCreate).toEqual({ success: false, error: "Color must be a hex value like #6366f1" });

    const label = (await createLabel("Long", "#3b82f6")).data!;
    const tooLong = await updateLabel(label.id, { description: "x".repeat(2_001) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error).toContain("at most 2000 characters");

    const badUpdate = await updateLabel(label.id, { color: "blue" });
    expect(badUpdate.success).toBe(false);
  });

  it("lets only project admins and personal-label owners update a label", async () => {
    const projectLabel = (await createLabel("Release", "#3b82f6", projectId)).data!;
    const personalLabel = (await createLabel("Mine", "#3b82f6")).data!;

    const { user: member } = await createTestUser(`label-member-${Date.now()}`);
    try {
      await db.projectMember.create({ data: { projectId, userId: member.id, role: "MEMBER" } });
      await createSession({ userId: member.id, email: member.email, name: member.name });

      expect((await updateLabel(projectLabel.id, { description: "hijacked" })).success).toBe(false);
      expect((await updateLabel(personalLabel.id, { description: "hijacked" })).success).toBe(false);

      const untouched = await db.label.findMany({ where: { id: { in: [projectLabel.id, personalLabel.id] } } });
      expect(untouched.every((l) => l.description === null)).toBe(true);

      await db.projectMember.updateMany({ where: { projectId, userId: member.id }, data: { role: "ADMIN" } });
      expect((await updateLabel(projectLabel.id, { description: "Ships on Fridays" })).success).toBe(true);
    } finally {
      await cleanupTestUser(member.id);
    }
  });
});
