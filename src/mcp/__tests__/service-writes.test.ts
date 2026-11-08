import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeMcpTool } from "../core";
import { db } from "@/lib/db";
import { triggerWebhooks } from "@/lib/webhooks";
import {
  cleanupTestUser,
  createTestCard,
  createTestColumn,
  createTestProject,
  createTestUser,
} from "@/test/helpers";

vi.mock("@/lib/webhooks", () => ({ triggerWebhooks: vi.fn() }));

describe("MCP writes go through the service layer", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;

  beforeEach(async () => {
    vi.mocked(triggerWebhooks).mockClear();
    userId = (await createTestUser(`mcp-service-writes-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Service Writes")).id;
    columnId = (await createTestColumn(projectId)).id;
    otherColumnId = (await createTestColumn(projectId)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  async function activityTypes(cardId: string) {
    const rows = await db.activity.findMany({ where: { cardId, actorUserId: userId }, select: { type: true } });
    return rows.map((row) => row.type);
  }

  function webhookEvents() {
    return vi.mocked(triggerWebhooks).mock.calls.map(([, event]) => event);
  }

  describe("activity and webhooks", () => {
    it("move_card records moved", async () => {
      const card = await createTestCard(projectId, columnId);

      await executeMcpTool("move_card", { id: card.id, targetColumnId: otherColumnId }, { userId });

      expect(await activityTypes(card.id)).toEqual(["moved"]);
      expect(webhookEvents()).toEqual(["moved"]);
    });

    it("reorder_cards records moved for a card that changes column", async () => {
      const card = await createTestCard(projectId, columnId);

      const res = await executeMcpTool(
        "reorder_cards",
        { items: [{ id: card.id, order: 5, columnId: otherColumnId }] },
        { userId }
      );

      expect(res).toEqual({ success: true, count: 1 });
      expect(await activityTypes(card.id)).toEqual(["moved"]);
      expect(webhookEvents()).toEqual(["moved"]);
    });

    it("archive_card and unarchive_card record their events", async () => {
      const card = await createTestCard(projectId, columnId);

      const archived = await executeMcpTool("archive_card", { id: card.id }, { userId });
      const restored = await executeMcpTool("unarchive_card", { id: card.id }, { userId });

      expect(archived.card!.isArchived).toBe(true);
      expect(restored.card!.isArchived).toBe(false);
      expect((await activityTypes(card.id)).sort()).toEqual(["archived", "unarchived"]);
      expect(webhookEvents().sort()).toEqual(["archived", "unarchived"]);
    });

    it("add_comment records comment_added", async () => {
      const card = await createTestCard(projectId, columnId);

      await executeMcpTool("add_comment", { cardId: card.id, content: "A note" }, { userId });

      expect(await activityTypes(card.id)).toEqual(["comment_added"]);
      expect(webhookEvents()).toEqual(["comment_added"]);
    });

    it("create_project fires project_created and still returns columns", async () => {
      const res = await executeMcpTool("create_project", { name: "From MCP" }, { userId });

      const project = res.project as unknown as { columns: unknown[]; members: Array<{ userId: string }> };
      expect(project.columns.length).toBeGreaterThan(0);
      expect(project.members.map((member) => member.userId)).toEqual([userId]);
      expect(webhookEvents()).toEqual(["project_created"]);
    });
  });

  describe("errors", () => {
    let intruderId: string;

    beforeEach(async () => {
      intruderId = (await createTestUser(`mcp-service-writes-intruder-${Date.now()}`)).user.id;
    });

    afterEach(async () => {
      await cleanupTestUser(intruderId);
    });

    it("reports no access as not found, so a record's existence stays hidden", async () => {
      const card = await createTestCard(projectId, columnId);
      const comment = await db.comment.create({ data: { cardId: card.id, author: "A", content: "Text" } });
      const asIntruder = { userId: intruderId };

      for (const [tool, args] of [
        ["move_card", { id: card.id, targetColumnId: otherColumnId }],
        ["archive_card", { id: card.id }],
        ["unarchive_card", { id: card.id }],
      ] as const) {
        await expect(executeMcpTool(tool, args, asIntruder)).rejects.toThrow(`Card with ID ${card.id} not found.`);
      }
      await expect(
        executeMcpTool("reorder_cards", { items: [{ id: card.id, order: 1 }] }, asIntruder)
      ).rejects.toThrow("One or more cards were not found.");
      await expect(
        executeMcpTool("update_comment", { commentId: comment.id, content: "X" }, asIntruder)
      ).rejects.toThrow(`Comment with ID ${comment.id} not found.`);
    });

    it("update_comment saves the trimmed text and rejects a non-string", async () => {
      const card = await createTestCard(projectId, columnId);
      const comment = await db.comment.create({ data: { cardId: card.id, author: "A", content: "Text" } });

      const res = await executeMcpTool("update_comment", { commentId: comment.id, content: "  New  " }, { userId });
      expect(res.comment!.content).toBe("New");

      await expect(
        executeMcpTool("update_comment", { commentId: comment.id, content: 42 }, { userId })
      ).rejects.toThrow("Comment content cannot be empty");
    });
  });

  describe("target column ownership", () => {
    let outsiderId: string;
    let foreignColumnId: string;
    let foreignProjectId: string;

    beforeEach(async () => {
      outsiderId = (await createTestUser(`mcp-service-writes-outsider-${Date.now()}`)).user.id;
      foreignProjectId = (await createTestProject(outsiderId, "Foreign")).id;
      await db.project.update({ where: { id: foreignProjectId }, data: { visibility: "INTERNAL" } });
      foreignColumnId = (await createTestColumn(foreignProjectId)).id;
    });

    afterEach(async () => {
      await cleanupTestUser(outsiderId);
    });

    it("the caller can read the foreign project's columns", async () => {
      const res = await executeMcpTool("list_columns", { projectId: foreignProjectId }, { userId });
      expect(res.columns!.map((column: { id: string }) => column.id)).toContain(foreignColumnId);
    });

    it("move_card refuses a column from another project", async () => {
      const card = await createTestCard(projectId, columnId);

      await expect(
        executeMcpTool("move_card", { id: card.id, targetColumnId: foreignColumnId }, { userId })
      ).rejects.toThrow("Invalid column");

      expect((await db.card.findUnique({ where: { id: card.id } }))!.columnId).toBe(columnId);
    });

    it("reorder_cards refuses the whole batch when one column is from another project", async () => {
      const first = await createTestCard(projectId, columnId);
      const second = await createTestCard(projectId, columnId);

      await expect(
        executeMcpTool(
          "reorder_cards",
          {
            items: [
              { id: first.id, order: 7, columnId: otherColumnId },
              { id: second.id, order: 8, columnId: foreignColumnId },
            ],
          },
          { userId }
        )
      ).rejects.toThrow("Invalid column");

      expect((await db.card.findUnique({ where: { id: first.id } }))!.columnId).toBe(columnId);
      expect((await db.card.findUnique({ where: { id: second.id } }))!.columnId).toBe(columnId);
    });
  });
});
