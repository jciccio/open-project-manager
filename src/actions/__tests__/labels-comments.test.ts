import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLabel, getLabels, deleteLabel } from "../labels";
import { addComment, updateComment, deleteComment } from "../comments";
import { createProject, getProjectById } from "../projects";
import { createCard } from "../cards";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";

describe("Labels & Comments Server Actions", () => {
  let userId: string;
  let projectId: string;
  let cardId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`labels-comments-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Labels/Comments Project" }, userId);
    projectId = pRes.data!.id;

    const projectDetails = await getProjectById(projectId, userId);
    const columnId = projectDetails.data!.columns[0].id;

    const cardRes = await createCard({ projectId, columnId, title: "Label Comment Card" }, userId);
    cardId = cardRes.data!.id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("creates, fetches, and deletes labels", async () => {
    const createRes = await createLabel("Bug", "#ef4444");
    expect(createRes.success).toBe(true);
    expect(createRes.data?.name).toBe("Bug");

    const getRes = await getLabels();
    expect(getRes.success).toBe(true);
    expect(getRes.data?.some((l) => l.name === "Bug")).toBe(true);

    const delRes = await deleteLabel(createRes.data!.id);
    expect(delRes.success).toBe(true);
  });

  it("creates and fetches project-scoped labels", async () => {
    const createRes = await createLabel("Feature", "#10b981", projectId);
    expect(createRes.success).toBe(true);
    expect(createRes.data?.name).toBe("Feature");
    expect(createRes.data?.projectId).toBe(projectId);

    const getRes = await getLabels(projectId);
    expect(getRes.success).toBe(true);
    expect(getRes.data?.some((l) => l.name === "Feature")).toBe(true);
  });

  it("blocks a second user from listing, creating in, or deleting from a project they don't own", async () => {
    const victimLabelRes = await createLabel("Victim Label", "#10b981", projectId);
    const victimLabelId = victimLabelRes.data!.id;

    const { user: attacker } = await createTestUser(`labels-attacker-${Date.now()}`);
    try {
      await createSession({ userId: attacker.id, email: attacker.email, name: attacker.name });

      const listRes = await getLabels(projectId);
      expect(listRes.success).toBe(false);

      const createRes = await createLabel("Attacker Label", "#ef4444", projectId);
      expect(createRes.success).toBe(false);

      const deleteRes = await deleteLabel(victimLabelId);
      expect(deleteRes.success).toBe(false);

      const stillThere = await db.label.findUnique({ where: { id: victimLabelId } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanupTestUser(attacker.id);
    }
  });

  it("never lets a regular user delete a global (no-owner) label", async () => {
    const globalLabel = await db.label.create({
      data: { name: `Global Label ${Date.now()}`, color: "#3b82f6" },
    });

    try {
      const res = await deleteLabel(globalLabel.id);
      expect(res.success).toBe(false);

      const stillThere = await db.label.findUnique({ where: { id: globalLabel.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await db.label.delete({ where: { id: globalLabel.id } });
    }
  });

  it("adds, updates, and deletes comments on a card", async () => {
    const addRes = await addComment(cardId, "Tester", "This is a test comment");
    expect(addRes.success).toBe(true);
    expect(addRes.data?.content).toBe("This is a test comment");

    const commentId = addRes.data!.id;
    const updateRes = await updateComment(commentId, "This is an updated comment");
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.content).toBe("This is an updated comment");

    const delRes = await deleteComment(commentId);
    expect(delRes.success).toBe(true);
  });
});

