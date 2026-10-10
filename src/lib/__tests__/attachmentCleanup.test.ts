import fs from "fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { createCard, deleteCard } from "@/lib/services/cards";
import { deleteColumn } from "@/lib/services/columns";
import { deleteProject } from "@/lib/services/projects";
import { uploadAttachment } from "@/lib/services/attachments";
import { getAttachmentFilePath } from "@/lib/attachmentStorage";
import { deleteRowsAndAttachmentFiles } from "@/lib/attachmentCleanup";
import { executeMcpTool } from "@/mcp/core";
import { db } from "@/lib/db";

describe("attachment files on delete", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`attach-cleanup-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Attachment Cleanup Project")).id;
    columnId = (await createTestColumn(projectId, "To Do", 0)).id;
    otherColumnId = (await createTestColumn(projectId, "Done", 1)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  async function cardWithFile(colId: string, title: string) {
    const card = await createCard({ projectId, columnId: colId, title }, userId);
    const uploaded = await uploadAttachment(
      { cardId: card.data!.id, filename: `${title}.txt`, contentBuffer: Buffer.from(title), mimeType: "text/plain" },
      userId
    );
    const path = getAttachmentFilePath(uploaded.data!.storageKey);
    expect(fs.existsSync(path)).toBe(true);
    return { cardId: card.data!.id, path };
  }

  it("removes a card's files when the card is deleted, and leaves other cards' files", async () => {
    const target = await cardWithFile(columnId, "target");
    const other = await cardWithFile(columnId, "other");

    expect((await deleteCard(target.cardId, userId)).success).toBe(true);

    expect(fs.existsSync(target.path)).toBe(false);
    expect(fs.existsSync(other.path)).toBe(true);
  });

  it("removes the files of every card in a deleted column", async () => {
    const inColumn = await cardWithFile(columnId, "in-column");
    const elsewhere = await cardWithFile(otherColumnId, "elsewhere");

    expect((await deleteColumn(columnId, userId)).success).toBe(true);

    expect(fs.existsSync(inColumn.path)).toBe(false);
    expect(fs.existsSync(elsewhere.path)).toBe(true);
  });

  it("removes the files of every card in a deleted project", async () => {
    const first = await cardWithFile(columnId, "first");
    const second = await cardWithFile(otherColumnId, "second");

    expect((await deleteProject(projectId, userId)).success).toBe(true);

    expect(fs.existsSync(first.path)).toBe(false);
    expect(fs.existsSync(second.path)).toBe(false);
  });

  it("removes files when cards, columns and projects are deleted through MCP", async () => {
    const card = await cardWithFile(columnId, "mcp-card");
    await executeMcpTool("delete_card", { id: card.cardId });
    expect(fs.existsSync(card.path)).toBe(false);

    const inColumn = await cardWithFile(columnId, "mcp-column");
    await executeMcpTool("delete_column", { id: columnId });
    expect(fs.existsSync(inColumn.path)).toBe(false);

    const inProject = await cardWithFile(otherColumnId, "mcp-project");
    await executeMcpTool("delete_project", { id: projectId });
    expect(fs.existsSync(inProject.path)).toBe(false);
  });

  it("leaves the files in place when the row delete fails", async () => {
    const card = await cardWithFile(columnId, "kept");

    await expect(
      deleteRowsAndAttachmentFiles({ cardId: card.cardId }, async () => {
        throw new Error("delete failed");
      })
    ).rejects.toThrow("delete failed");

    expect(fs.existsSync(card.path)).toBe(true);
    expect(await db.attachment.count({ where: { cardId: card.cardId } })).toBe(1);
    await fs.promises.unlink(card.path);
  });
});
