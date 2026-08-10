import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCard, updateCard, moveCard, deleteCard, getCardByIdentifier } from "../cards";
import { createProject, getProjectById } from "../projects";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { createSession, destroySession } from "@/lib/auth";

describe("Cards Server Actions", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let targetColumnId: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`cards-action-${Date.now()}`);
    userId = user.id;
    await createSession({ userId, email: user.email, name: user.name });

    const pRes = await createProject({ name: "Card Test Project" });
    projectId = pRes.data!.id;

    const projectDetails = await getProjectById(projectId);
    columnId = projectDetails.data!.columns[0].id;
    targetColumnId = projectDetails.data!.columns[1].id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(userId);
  });

  it("creates a new card in a column with sequential number", async () => {
    const res1 = await createCard({
      projectId,
      columnId,
      title: "Task 1",
      description: "Sample card description",
      priority: "HIGH",
      points: 3,
      owner: "Dev Lead",
    });

    expect(res1.success).toBe(true);
    expect(res1.data?.title).toBe("Task 1");
    expect(res1.data?.number).toBe(1);

    const res2 = await createCard({
      projectId,
      columnId,
      title: "Task 2",
    });
    expect(res2.success).toBe(true);
    expect(res2.data?.number).toBe(2);
  });

  it("resolves card by human-readable identifier", async () => {
    await createCard({ projectId, columnId, title: "Identifier Card" });

    const lookupRes = await getCardByIdentifier("CTP-1");
    expect(lookupRes.success).toBe(true);
    expect(lookupRes.data?.title).toBe("Identifier Card");
    expect(lookupRes.data?.identifier).toBe("CTP-1");
  });

  it("validates empty title", async () => {
    const res = await createCard({
      projectId,
      columnId,
      title: "  ",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Card title is required");
  });

  it("updates card details", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Original Title" });
    const cardId = cardRes.data!.id;

    const updateRes = await updateCard(cardId, {
      title: "Updated Title",
      priority: "URGENT",
      points: 8,
    });

    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.title).toBe("Updated Title");
    expect(updateRes.data?.priority).toBe("URGENT");
    expect(updateRes.data?.points).toBe(8);
  });

  it("moves card between columns", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Move Card" });
    const cardId = cardRes.data!.id;

    const moveRes = await moveCard(cardId, targetColumnId, 0);
    expect(moveRes.success).toBe(true);
    expect(moveRes.data?.columnId).toBe(targetColumnId);
  });

  it("deletes a card", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Card To Delete" });
    const cardId = cardRes.data!.id;

    const delRes = await deleteCard(cardId);
    expect(delRes.success).toBe(true);
  });
});

