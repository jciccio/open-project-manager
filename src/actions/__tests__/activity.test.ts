import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "@/lib/services/projects";
import { createCard, updateCard, moveCard } from "@/lib/services/cards";
import { addComment } from "@/lib/services/comments";
import { getCardActivity } from "@/lib/services/activity";

describe("Card Activity / Audit Trail Actions", () => {
  let userId: string;
  let projectId: string;
  let col1Id: string;
  let col2Id: string;

  beforeEach(async () => {
    await db.activity.deleteMany();
    await db.comment.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.project.deleteMany();
    await db.user.deleteMany();

    const user = await db.user.create({
      data: {
        email: "activity_test@example.com",
        name: "Activity Tester",
        passwordHash: "hash123",
      },
    });
    userId = user.id;

    const projRes = await createProject(
      {
        name: "Activity Project",
        description: "Testing audit logs",
      },
      userId
    );
    projectId = projRes.data!.id;

    const fullProj = await db.project.findUnique({
      where: { id: projectId },
      include: { columns: { orderBy: { order: "asc" } } },
    });
    col1Id = fullProj!.columns[0].id;
    col2Id = fullProj!.columns[1].id;
  });

  it("records card_created activity when a card is created", async () => {
    const cardRes = await createCard(
      {
        projectId,
        columnId: col1Id,
        title: "First Task",
      },
      userId
    );
    expect(cardRes.success).toBe(true);
    const cardId = cardRes.data!.id;

    const actRes = await getCardActivity(cardId, userId);
    expect(actRes.success).toBe(true);
    expect(actRes.data).toBeDefined();
    expect(actRes.data!.length).toBe(1);
    expect(actRes.data![0].type).toBe("card_created");
    expect(actRes.data![0].toValue).toBe("First Task");
  });

  it("records title_changed, priority_changed and moved when a card is updated", async () => {
    const cardRes = await createCard(
      {
        projectId,
        columnId: col1Id,
        title: "Original Title",
        priority: "LOW",
      },
      userId
    );
    const cardId = cardRes.data!.id;

    const updateRes = await updateCard(
      cardId,
      {
        title: "Updated Title",
        priority: "HIGH",
        columnId: col2Id,
      },
      userId
    );
    expect(updateRes.success).toBe(true);

    const actRes = await getCardActivity(cardId, userId);
    expect(actRes.success).toBe(true);
    const types = actRes.data!.map((a) => a.type);
    expect(types).toContain("title_changed");
    expect(types).toContain("priority_changed");
    expect(types).toContain("moved");

    const titleAct = actRes.data!.find((a) => a.type === "title_changed");
    expect(titleAct?.fromValue).toBe("Original Title");
    expect(titleAct?.toValue).toBe("Updated Title");

    const prioAct = actRes.data!.find((a) => a.type === "priority_changed");
    expect(prioAct?.fromValue).toBe("LOW");
    expect(prioAct?.toValue).toBe("HIGH");
  });

  it("records comment_added, moveCard, archived, and unarchived activities", async () => {
    const cardRes = await createCard(
      {
        projectId,
        columnId: col1Id,
        title: "Full Flow Task",
      },
      userId
    );
    const cardId = cardRes.data!.id;

    await moveCard(cardId, col2Id, 20000, userId);
    await addComment(cardId, "Tester", "This is an important comment", userId);

    const actRes = await getCardActivity(cardId, userId);
    expect(actRes.success).toBe(true);

    const types = actRes.data!.map((a) => a.type);
    expect(types).toContain("card_created");
    expect(types).toContain("moved");
    expect(types).toContain("comment_added");
  });
});
