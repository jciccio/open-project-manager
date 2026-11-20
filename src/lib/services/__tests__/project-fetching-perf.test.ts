import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getProjectById, getProjectBoard } from "../projects";
import { createCard, updateCard } from "../cards";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { NextRequest } from "next/server";
import { GET as getCardsRoute } from "@/app/api/v1/cards/route";
import { signToken } from "@/lib/auth";

describe("Project data fetching performance optimizations (Issue #105)", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let token: string;

  beforeEach(async () => {
    const { user } = await createTestUser(`perf-${Date.now()}`);
    userId = user.id;
    token = await signToken({ userId, email: user.email, name: user.name });

    const project = await db.project.create({
      data: {
        name: "Performance Test Project",
        userId,
        columns: {
          create: [{ name: "Column 1", order: 0 }],
        },
      },
      include: { columns: true },
    });
    projectId = project.id;
    columnId = project.columns[0].id;
  });

  afterEach(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    if (userId) {
      await cleanupTestUser(userId);
    }
  });

  it("returns cards with _count.comments and moved activities in getProjectBoard, while getProjectById preserves full history", async () => {
    const cardRes = await createCard({
      projectId,
      columnId,
      title: "Perf Card",
    }, userId);
    expect(cardRes.success).toBe(true);
    const cardId = cardRes.data!.id;

    // Add comments and activities to the card
    await db.comment.create({
      data: { cardId, author: "Tester", content: "Comment 1" },
    });
    await db.comment.create({
      data: { cardId, author: "Tester", content: "Comment 2" },
    });
    await db.activity.create({
      data: { cardId, actorUserId: userId, type: "test_activity" },
    });
    await db.activity.create({
      data: { cardId, actorUserId: userId, type: "moved", fromValue: "Col1", toValue: "Col2" },
    });

    const project = await getProjectBoard(projectId, userId);
    expect(project.success).toBe(true);
    const fetchedCard = project.data!.columns[0].cards[0] as any;

    // _count.comments should reflect the count
    expect(fetchedCard._count).toBeDefined();
    expect(fetchedCard._count.comments).toBe(2);

    // comments should not be loaded on the board, and activities only includes narrow moved activities for analytics
    expect(fetchedCard.comments).toBeUndefined();
    expect(fetchedCard.activities.length).toBe(1);
    expect(fetchedCard.activities[0].type).toBe("moved");
    expect(fetchedCard.activities[0].id).toBeDefined();

    // Verify getProjectById still preserves full relations for public REST callers
    const fullProject = await getProjectById(projectId, userId);
    expect(fullProject.success).toBe(true);
    const fullCard = fullProject.data!.columns[0].cards[0] as any;
    expect(fullCard.comments.length).toBe(2);
    expect(fullCard.activities.length).toBe(3);
  });

  it("batches multiple activity updates in updateCard", async () => {
    const cardRes = await createCard({
      projectId,
      columnId,
      title: "Batch Activity Card",
    }, userId);
    const cardId = cardRes.data!.id;

    const label1 = await db.label.create({ data: { name: "Label 1", color: "#ff0000", projectId, userId } });
    const label2 = await db.label.create({ data: { name: "Label 2", color: "#00ff00", projectId, userId } });

    const findManySpy = vi.spyOn(db.label, "findMany");

    // Update title, priority, description, and labels simultaneously
    const updateRes = await updateCard(cardId, {
      title: "Updated Title",
      priority: "HIGH",
      description: "Updated Description",
      labelIds: [label1.id, label2.id],
    }, userId);
    expect(updateRes.success).toBe(true);

    expect(findManySpy).toHaveBeenCalledTimes(1);
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: expect.arrayContaining([label1.id, label2.id]) } },
      })
    );
    findManySpy.mockRestore();

    const activities = await db.activity.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
    });

    const types = activities.map((a) => a.type);
    expect(types).toContain("title_changed");
    expect(types).toContain("priority_changed");
    expect(types).toContain("description_changed");
    expect(types).toContain("label_added");
  });

  it("limits comments on GET /api/v1/cards and includes _count.comments", async () => {
    const cardRes = await createCard({
      projectId,
      columnId,
      title: "API Limit Card",
    }, userId);
    const cardId = cardRes.data!.id;

    // Add 15 comments
    const baseTime = Date.now();
    for (let i = 0; i < 15; i++) {
      await db.comment.create({
        data: {
          cardId,
          author: `User ${i}`,
          content: `Comment ${i}`,
          createdAt: new Date(baseTime + i * 1000),
        },
      });
    }

    const req = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await getCardsRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    const card = body.data[0];

    expect(card._count?.comments).toBe(15);
    // Comments on card list should be bounded to 10 newest in chronological order
    expect(card.comments.length).toBe(10);
    expect(card.comments[0].content).toBe("Comment 5");
    expect(card.comments[9].content).toBe("Comment 14");
  });

  it("denies access in getProjectBoard for a non-member on a private project", async () => {
    const { user: stranger } = await createTestUser(`stranger-${Date.now()}`);
    try {
      const res = await getProjectBoard(projectId, stranger.id);
      expect(res.success).toBe(false);
      expect(res.error).toBe("Project not found or access denied");
    } finally {
      await cleanupTestUser(stranger.id);
    }
  });
});
