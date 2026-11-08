import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { executeMcpTool } from "@/mcp/core";
import { getProjectById } from "@/lib/services/projects";
import { cleanupTestUser, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";

const CARD_COUNT = 1100;

describe("projects with more cards than Prisma's default SQLite parameter limit", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`large-project-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Large")).id;
    const columnId = (await createTestColumn(projectId)).id;
    await db.card.createMany({
      data: Array.from({ length: CARD_COUNT }, (_, index) => ({
        projectId,
        columnId,
        title: `Card ${index}`,
        number: index + 1,
        order: index,
      })),
    });
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  function cardCount(project: { columns: Array<{ cards: unknown[] }> }) {
    return project.columns.reduce((total, column) => total + column.cards.length, 0);
  }

  it("getProjectById returns every card", async () => {
    const res = await getProjectById(projectId, userId);

    expect(res.success).toBe(true);
    expect(cardCount(res.data!)).toBe(CARD_COUNT);
  });

  it("MCP get_project returns every card", async () => {
    const res = (await executeMcpTool("get_project", { id: projectId }, { userId })) as unknown as {
      project: { columns: Array<{ cards: unknown[] }> };
    };

    expect(cardCount(res.project)).toBe(CARD_COUNT);
  });
});
