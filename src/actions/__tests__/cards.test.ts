import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCard, updateCard, moveCard, deleteCard, getCardByIdentifier, archiveCard, unarchiveCard, getArchivedCards, reorderCards } from "../cards";
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
    expect(res2.data?.priority).toBe("NONE");
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

  it("sets completedAt when moving card to a Done column and clears it when moved out", async () => {
    const projectDetails = await getProjectById(projectId);
    const doneColumnId = projectDetails.data!.columns.find((c) => c.isDone)!.id;

    const cardRes = await createCard({ projectId, columnId, title: "Timestamp Card" });
    const cardId = cardRes.data!.id;
    expect(cardRes.data?.completedAt).toBeNull();

    const moveDoneRes = await moveCard(cardId, doneColumnId, 0);
    expect(moveDoneRes.success).toBe(true);
    expect(moveDoneRes.data?.completedAt).not.toBeNull();

    const moveBackRes = await moveCard(cardId, columnId, 0);
    expect(moveBackRes.success).toBe(true);
    expect(moveBackRes.data?.completedAt).toBeNull();
  });

  it("archives and unarchives a card", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Card To Archive" });
    const cardId = cardRes.data!.id;

    const archRes = await archiveCard(cardId);
    expect(archRes.success).toBe(true);
    expect(archRes.data?.isArchived).toBe(true);

    const getArchivedRes = await getArchivedCards();
    expect(getArchivedRes.success).toBe(true);
    expect(getArchivedRes.data?.some((c) => c.id === cardId)).toBe(true);

    const unarchRes = await unarchiveCard(cardId);
    expect(unarchRes.success).toBe(true);
    expect(unarchRes.data?.isArchived).toBe(false);
  });

  it("deletes a card", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Card To Delete" });
    const cardId = cardRes.data!.id;

    const delRes = await deleteCard(cardId);
    expect(delRes.success).toBe(true);
  });

  it("reorders multiple cards atomically using reorderCards", async () => {
    const c1 = await createCard({ projectId, columnId, title: "Card A" });
    const c2 = await createCard({ projectId, columnId, title: "Card B" });

    expect(c1.data?.order).toBe(10000);
    expect(c2.data?.order).toBe(20000);

    const reorderRes = await reorderCards([
      { id: c1.data!.id, order: 25000 },
      { id: c2.data!.id, order: 5000 },
    ]);
    expect(reorderRes.success).toBe(true);
  });

  it("supports parent and sub-card nesting and prevents self-parenting", async () => {
    const parentCard = await createCard({ projectId, columnId, title: "Parent Epic" });
    const parentId = parentCard.data!.id;

    const childCard = await createCard({
      projectId,
      columnId,
      title: "Sub-task 1",
      parentId,
    });
    expect(childCard.success).toBe(true);
    expect(childCard.data?.parentId).toBe(parentId);
    expect(childCard.data?.parent?.title).toBe("Parent Epic");

    const selfParentRes = await updateCard(parentId, { parentId });
    expect(selfParentRes.success).toBe(false);
    expect(selfParentRes.error).toBe("A card cannot be its own parent");
  });

  it("supports assigning structured users to a card", async () => {
    const cardRes = await createCard({
      projectId,
      columnId,
      title: "Card With Assignees",
      assigneeIds: [userId],
    });
    expect(cardRes.success).toBe(true);
    expect(cardRes.data?.assignees.length).toBe(1);
    expect(cardRes.data?.assignees[0].user.id).toBe(userId);

    const updateRes = await updateCard(cardRes.data!.id, { assigneeIds: [] });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.assignees.length).toBe(0);
  });

  it("adds and removes external links from a card", async () => {
    const cardRes = await createCard({ projectId, columnId, title: "Card With Links" });
    const cardId = cardRes.data!.id;

    const { addCardLink, removeCardLink } = await import("../cards");

    const linkRes = await addCardLink(cardId, "https://github.com", "GitHub");
    expect(linkRes.success).toBe(true);
    expect(linkRes.data?.url).toBe("https://github.com");
    expect(linkRes.data?.title).toBe("GitHub");

    const lookupRes = await getCardByIdentifier(`CTP-${cardRes.data!.number}`);
    expect(lookupRes.data?.links.length).toBe(1);
    expect(lookupRes.data?.links[0].url).toBe("https://github.com");

    const removeRes = await removeCardLink(linkRes.data!.id);
    expect(removeRes.success).toBe(true);

    const lookupRes2 = await getCardByIdentifier(`CTP-${cardRes.data!.number}`);
    expect(lookupRes2.data?.links.length).toBe(0);
  });

  it("clears description, owner, and due date when explicitly set to null", async () => {
    const cardRes = await createCard({
      projectId,
      columnId,
      title: "Card To Clear",
      description: "Some description",
      owner: "Alice",
      dueDate: "2026-12-01",
    });
    const cardId = cardRes.data!.id;
    expect(cardRes.data?.description).toBe("Some description");
    expect(cardRes.data?.owner).toBe("Alice");
    expect(cardRes.data?.dueDate).not.toBeNull();

    const clearRes = await updateCard(cardId, {
      description: null,
      owner: null,
      dueDate: null,
    });
    expect(clearRes.success).toBe(true);
    expect(clearRes.data?.description).toBeNull();
    expect(clearRes.data?.owner).toBeNull();
    expect(clearRes.data?.dueDate).toBeNull();

    const untouchedRes = await updateCard(cardId, { title: "Card To Clear (renamed)" });
    expect(untouchedRes.success).toBe(true);
    expect(untouchedRes.data?.description).toBeNull();
  });
});


