import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createScopedLabel, LabelExistsError } from "../scopedLabels";

describe("createScopedLabel()", () => {
  let userId: string;
  let otherUserId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`scoped-labels-${Date.now()}`)).user.id;
    otherUserId = (await createTestUser(`scoped-labels-other-${Date.now()}`)).user.id;
    projectId = (await db.project.create({ data: { userId, name: "Labels A", key: `LA${Date.now() % 100000}` } })).id;
    otherProjectId = (await db.project.create({ data: { userId, name: "Labels B", key: `LB${Date.now() % 100000}` } })).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
    await cleanupTestUser(otherUserId);
  });

  it("refuses a second project label with the same trimmed name", async () => {
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId, userId: null });

    await expect(createScopedLabel({ name: " Bug ", color: "#000000", projectId, userId: null })).rejects.toBeInstanceOf(
      LabelExistsError
    );
    expect(await db.label.count({ where: { projectId, name: "Bug" } })).toBe(1);
  });

  it("refuses a second personal label with the same name for the same user", async () => {
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId: null, userId });

    await expect(createScopedLabel({ name: "Bug", color: "#ef4444", projectId: null, userId })).rejects.toBeInstanceOf(
      LabelExistsError
    );
    expect(await db.label.count({ where: { userId, name: "Bug" } })).toBe(1);
  });

  it("allows the same name in another project, for another user, and across scopes", async () => {
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId, userId: null });
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId: otherProjectId, userId: null });
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId: null, userId });
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId: null, userId: otherUserId });

    expect(await db.label.count({ where: { name: "Bug", OR: [{ projectId: { in: [projectId, otherProjectId] } }, { userId: { in: [userId, otherUserId] } }] } })).toBe(4);
  });

  it("treats names as case-sensitive, like the original constraint", async () => {
    await createScopedLabel({ name: "Bug", color: "#ef4444", projectId, userId: null });
    await createScopedLabel({ name: "bug", color: "#ef4444", projectId, userId: null });

    expect(await db.label.count({ where: { projectId } })).toBe(2);
  });
});
