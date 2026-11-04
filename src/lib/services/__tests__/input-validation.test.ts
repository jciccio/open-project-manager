import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCard, updateCard, reorderCards } from "@/lib/services/cards";
import { createSavedView, updateSavedView } from "@/lib/services/views";
import { createCardType, updateCardType } from "@/lib/services/cardTypes";
import {
  cleanupTestUser,
  createTestCard,
  createTestCardType,
  createTestColumn,
  createTestProject,
  createTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";

describe("service input validation", () => {
  let userId: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`svc-validation-${Date.now()}`)).user.id;
    projectId = (await createTestProject(userId, "Validation")).id;
    columnId = (await createTestColumn(projectId)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("createCard rejects an unknown priority", async () => {
    const res = await createCard({ projectId, columnId, title: "Card", priority: "BOGUS" }, userId);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^priority: /);
  });

  it("updateCard rejects an over-long title and unknown keys", async () => {
    const card = await createTestCard(projectId, columnId);
    const long = await updateCard(card.id, { title: "x".repeat(501) }, userId);
    expect(long.error).toMatch(/^title: /);

    const unknown = await updateCard(card.id, { title: "Ok", bogus: 1 } as never, userId);
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain("bogus");
    expect((await db.card.findUnique({ where: { id: card.id } }))!.title).toBe(card.title);
  });

  it("reorderCards rejects a non-integer order", async () => {
    const card = await createTestCard(projectId, columnId);
    const res = await reorderCards([{ id: card.id, order: 1.5 }], userId);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^items\.0\.order: /);
  });

  it("createSavedView and updateSavedView reject filterJson that is not a JSON object", async () => {
    const created = await createSavedView(projectId, { name: "View", filterJson: "[1,2]" }, userId);
    expect(created.success).toBe(false);
    expect(created.error).toMatch(/^filterJson: /);

    const view = await db.savedView.create({ data: { projectId, name: "Existing", filterJson: "{}" } });
    const updated = await updateSavedView(view.id, { filterJson: "not json" }, userId);
    expect(updated.success).toBe(false);
    expect(updated.error).toMatch(/^filterJson: /);
  });

  it("createCardType and updateCardType reject a non-hex color and an empty name", async () => {
    const created = await createCardType("Story", projectId, "Book", "red", userId);
    expect(created.success).toBe(false);
    expect(created.error).toMatch(/^color: /);

    const type = await createTestCardType(projectId);
    const updated = await updateCardType(type.id, { name: "   " }, userId);
    expect(updated.success).toBe(false);
    expect(updated.error).toMatch(/^name: /);
  });
});
