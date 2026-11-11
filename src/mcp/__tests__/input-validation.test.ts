import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool } from "../core";
import {
  cleanupTestUser,
  createTestCard,
  createTestCardType,
  createTestColumn,
  createTestProject,
  createTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";
import { MAX_COMMENT_LENGTH } from "@/lib/validation/comments";

describe("MCP tool input validation", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`mcp-validation-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "MCP Validation")).id;
    columnId = (await createTestColumn(projectId)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("create_card rejects an unknown priority and accepts the userId envelope argument", async () => {
    await expect(
      executeMcpTool("create_card", { projectId, columnId, title: "Card", priority: "ASAP" }, { userId })
    ).rejects.toThrow(/^priority: /);

    const res = await executeMcpTool("create_card", { projectId, columnId, title: "Card", userId }, { userId });
    expect(res.success).toBe(true);
  });

  it("update_card rejects an empty title", async () => {
    const card = await createTestCard(projectId, columnId);
    await expect(executeMcpTool("update_card", { id: card.id, title: "  " }, { userId })).rejects.toThrow(/^title: /);
  });

  it("create_card and update_card refuse a column, card type or assignee from another project", async () => {
    const otherProjectId = (await createTestProject(userId, "Other")).id;
    const otherColumnId = (await createTestColumn(otherProjectId)).id;
    const otherTypeId = (await createTestCardType(otherProjectId)).id;
    const outsider = (await createTestUser(`mcp-validation-outsider-${Date.now()}`)).user.id;
    try {
      await expect(
        executeMcpTool("create_card", { projectId, columnId: otherColumnId, title: "Card" }, { userId })
      ).rejects.toThrow("Invalid column");
      await expect(
        executeMcpTool("create_card", { projectId, columnId, title: "Card", typeId: otherTypeId }, { userId })
      ).rejects.toThrow("Invalid card type");

      const card = await createTestCard(projectId, columnId);
      await expect(
        executeMcpTool("update_card", { id: card.id, columnId: otherColumnId }, { userId })
      ).rejects.toThrow("Invalid column");
      await expect(
        executeMcpTool("update_card", { id: card.id, assigneeIds: [outsider] }, { userId })
      ).rejects.toThrow("Assignees must be members of this project");
      expect((await db.card.findUnique({ where: { id: card.id } }))!.columnId).toBe(columnId);
    } finally {
      await cleanupTestUser(outsider);
    }
  });

  it("reorder_cards rejects a non-integer order", async () => {
    const card = await createTestCard(projectId, columnId);
    await expect(
      executeMcpTool("reorder_cards", { items: [{ id: card.id, order: 2.5 }] }, { userId })
    ).rejects.toThrow(/^items\.0\.order: /);
  });

  it("create_card and update_card reject fractional points", async () => {
    await expect(
      executeMcpTool("create_card", { projectId, columnId, title: "Card", points: 1.5 }, { userId })
    ).rejects.toThrow(/^points: /);

    const card = await createTestCard(projectId, columnId);
    await expect(executeMcpTool("update_card", { id: card.id, points: 1.5 }, { userId })).rejects.toThrow(/^points: /);
  });

  it("add_card_link refuses a javascript: URL and stores nothing", async () => {
    const card = await createTestCard(projectId, columnId);
    await expect(
      executeMcpTool("add_card_link", { cardId: card.id, url: "javascript:alert(1)" }, { userId })
    ).rejects.toThrow("Link URL must be");
    await expect(executeMcpTool("add_card_link", { cardId: card.id, url: 42 }, { userId })).rejects.toThrow(
      "Link URL must be"
    );
    expect(await db.cardLink.count({ where: { cardId: card.id } })).toBe(0);

    const res = await executeMcpTool("add_card_link", { cardId: card.id, url: "https://example.com" }, { userId });
    expect(res.success).toBe(true);
  });

  it("create_project and update_project reject a non-string or blank name", async () => {
    await expect(executeMcpTool("create_project", { name: 42 }, { userId })).rejects.toThrow("Project name is required");
    await expect(executeMcpTool("create_project", { name: "  " }, { userId })).rejects.toThrow(
      "Project name is required"
    );

    await expect(executeMcpTool("update_project", { id: projectId, name: 42 }, { userId })).rejects.toThrow(
      "Project name is required"
    );
    expect((await db.project.findUnique({ where: { id: projectId } }))!.name).toBe("MCP Validation");
  });

  it("create_card_type and update_card_type reject a bad color and an over-long name", async () => {
    await expect(
      executeMcpTool("create_card_type", { projectId, name: "Story", color: "#12345" }, { userId })
    ).rejects.toThrow(/^color: /);

    const type = await createTestCardType(projectId);
    await expect(
      executeMcpTool("update_card_type", { id: type.id, name: "x".repeat(101) }, { userId })
    ).rejects.toThrow(/^name: /);
  });

  it("create_saved_view and update_saved_view reject filterJson that is not a JSON object", async () => {
    await expect(
      executeMcpTool("create_saved_view", { projectId, name: "View", filterJson: "[]" }, { userId })
    ).rejects.toThrow(/^filterJson: /);

    const view = await db.savedView.create({ data: { projectId, name: "Existing", filterJson: "{}" } });
    await expect(
      executeMcpTool("update_saved_view", { id: view.id, filterJson: "nope" }, { userId })
    ).rejects.toThrow(/^filterJson: /);

    const created = await executeMcpTool(
      "create_saved_view",
      { projectId, name: "Object filter", filterJson: { search: "x" } },
      { userId }
    );
    expect(JSON.parse((created as any).savedView.filterJson)).toEqual({ search: "x" });
  });

  it("add_comment rejects non-string, blank and over-limit content without writing", async () => {
    const card = await createTestCard(projectId, columnId);
    await expect(executeMcpTool("add_comment", { cardId: card.id, content: 42 }, { userId })).rejects.toThrow(/cannot be empty/);
    await expect(executeMcpTool("add_comment", { cardId: card.id, content: "   " }, { userId })).rejects.toThrow(/cannot be empty/);
    await expect(
      executeMcpTool("add_comment", { cardId: card.id, content: "x".repeat(MAX_COMMENT_LENGTH + 1) }, { userId })
    ).rejects.toThrow(/characters or fewer/);
    expect(await db.comment.count({ where: { cardId: card.id } })).toBe(0);
  });

  it("update_comment rejects non-string, blank and over-limit content and keeps the stored text", async () => {
    const card = await createTestCard(projectId, columnId);
    const added = await executeMcpTool("add_comment", { cardId: card.id, content: "Original" }, { userId });
    const commentId = (added as any).comment.id;

    await expect(executeMcpTool("update_comment", { commentId, content: 42 }, { userId })).rejects.toThrow(/cannot be empty/);
    await expect(executeMcpTool("update_comment", { commentId, content: "   " }, { userId })).rejects.toThrow(/cannot be empty/);
    await expect(
      executeMcpTool("update_comment", { commentId, content: "x".repeat(MAX_COMMENT_LENGTH + 1) }, { userId })
    ).rejects.toThrow(/characters or fewer/);
    expect((await db.comment.findUnique({ where: { id: commentId } }))?.content).toBe("Original");

    const updated = await executeMcpTool("update_comment", { commentId, content: "  Edited  " }, { userId });
    expect((updated as any).comment.content).toBe("Edited");
  });
});
