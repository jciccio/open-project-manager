import fs from "fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { createSavedView, updateSavedView } from "@/lib/services/views";
import { updateColumn } from "@/lib/services/columns";
import { createCard } from "@/lib/services/cards";
import { uploadAttachment } from "@/lib/services/attachments";
import { UPLOADS_DIR } from "@/lib/attachmentStorage";
import { runImport } from "@/lib/import/runImport";
import type { Importer, ImportSummary } from "@/lib/import/types";
import { executeMcpTool } from "@/mcp/core";

// Runs the real transaction callback with the real `tx`, then throws, so the
// transaction rolls back after every write in it has happened.
function failNextTransactionAfterWrites() {
  const real = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  return vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
    real(async (tx: unknown) => {
      await fn(tx);
      throw new Error("injected failure");
    }, opts)) as never);
}

describe("multi-step writes leave no partial state", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`multi-step-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Multi-step Project")).id;
    columnId = (await createTestColumn(projectId, "To Do", 0)).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUser(userId);
  });

  describe("saved-view defaults", () => {
    async function defaultViewNames() {
      return (await db.savedView.findMany({ where: { projectId, isDefault: true } })).map((v) => v.name);
    }

    it("keeps the previous default when creating a new default fails", async () => {
      await createSavedView(projectId, { name: "First", isDefault: true }, userId);

      failNextTransactionAfterWrites();
      const res = await createSavedView(projectId, { name: "Second", isDefault: true }, userId);

      expect(res.success).toBe(false);
      expect(await defaultViewNames()).toEqual(["First"]);
    });

    it("keeps the previous default when a new default's name is already taken", async () => {
      await createSavedView(projectId, { name: "First", isDefault: true }, userId);
      await createSavedView(projectId, { name: "Taken" }, userId);

      const res = await createSavedView(projectId, { name: "Taken", isDefault: true }, userId);

      expect(res.success).toBe(false);
      expect(await defaultViewNames()).toEqual(["First"]);
    });

    it("keeps the previous default when making another view the default fails", async () => {
      await createSavedView(projectId, { name: "First", isDefault: true }, userId);
      const other = await createSavedView(projectId, { name: "Other" }, userId);

      failNextTransactionAfterWrites();
      const res = await updateSavedView(other.data!.id, { isDefault: true }, userId);

      expect(res.success).toBe(false);
      expect(await defaultViewNames()).toEqual(["First"]);
    });

    it("keeps the previous default when an MCP create_saved_view fails on a taken name", async () => {
      await createSavedView(projectId, { name: "First", isDefault: true }, userId);
      await createSavedView(projectId, { name: "Taken" }, userId);

      await expect(
        executeMcpTool("create_saved_view", { projectId, name: "Taken", isDefault: true })
      ).rejects.toThrow();
      expect(await defaultViewNames()).toEqual(["First"]);
    });
  });

  describe("column done-state", () => {
    it("leaves the column and its cards unchanged when marking it done fails", async () => {
      const card = await createCard({ projectId, columnId, title: "Open card" }, userId);

      failNextTransactionAfterWrites();
      const res = await updateColumn(columnId, { isDone: true }, userId);

      expect(res.success).toBe(false);
      expect((await db.column.findUnique({ where: { id: columnId } }))?.isDone).toBe(false);
      expect((await db.card.findUnique({ where: { id: card.data!.id } }))?.completedAt).toBeNull();
    });

    it("leaves the column and its cards unchanged when the MCP update_column fails", async () => {
      const card = await createCard({ projectId, columnId, title: "Open card" }, userId);

      failNextTransactionAfterWrites();
      await expect(executeMcpTool("update_column", { id: columnId, isDone: true })).rejects.toThrow("injected failure");

      expect((await db.column.findUnique({ where: { id: columnId } }))?.isDone).toBe(false);
      expect((await db.card.findUnique({ where: { id: card.data!.id } }))?.completedAt).toBeNull();
    });
  });

  describe("attachment upload", () => {
    it("removes the written file and leaves no row when saving the attachment fails", async () => {
      const card = await createCard({ projectId, columnId, title: "Upload card" }, userId);
      const filename = `rollback-${Date.now()}.txt`;

      failNextTransactionAfterWrites();
      const res = await uploadAttachment(
        { cardId: card.data!.id, filename, contentBuffer: Buffer.from("x"), mimeType: "text/plain" },
        userId
      );

      expect(res.success).toBe(false);
      expect(await db.attachment.count({ where: { cardId: card.data!.id } })).toBe(0);
      expect(fs.readdirSync(UPLOADS_DIR).filter((f) => f.endsWith(filename))).toEqual([]);
    });
  });

  describe("import mapping", () => {
    it("deletes a row it created when recording the mapping fails", async () => {
      const importer: Importer = {
        name: "fake",
        async *fetchProjects() {
          yield { sourceId: "proj-unmapped", name: "Unmapped Import" };
        },
        async *fetchColumns() {},
        async *fetchCardTypes() {},
        async *fetchLabels() {},
        async *fetchCards() {},
        async *fetchComments() {},
      };
      const upsert = vi.spyOn(db.importRecord, "upsert").mockRejectedValueOnce(new Error("mapping write failed"));

      const summary = (await runImport(importer, userId)) as ImportSummary;

      expect(upsert).toHaveBeenCalledTimes(1);
      expect(summary.records[0].status).toBe("failed");
      expect(await db.project.count({ where: { userId, name: "Unmapped Import" } })).toBe(0);
    });
  });
});
