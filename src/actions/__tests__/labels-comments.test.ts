import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLabel, getLabels, deleteLabel } from "../labels";
import { addComment, updateComment, deleteComment } from "../comments";
import { createProject, getProjectById } from "../projects";
import { createCard } from "../cards";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";

describe("Labels & Comments Server Actions", () => {
  let userId: string;
  let projectId: string;
  let cardId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`labels-comments-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Labels/Comments Project" });
    projectId = pRes.data!.id;

    const projectDetails = await getProjectById(projectId);
    const columnId = projectDetails.data!.columns[0].id;

    const cardRes = await createCard({ projectId, columnId, title: "Label Comment Card" });
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

