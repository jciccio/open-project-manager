import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestUser,
  createTestProject,
  createTestColumn,
  createTestCard,
  cleanupTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";
import * as projectsService from "@/lib/services/projects";
import * as cardsService from "@/lib/services/cards";
import * as commentsService from "@/lib/services/comments";
import * as attachmentsService from "@/lib/services/attachments";
import * as labelsService from "@/lib/services/labels";
import * as relationsService from "@/lib/services/relations";
import * as columnsService from "@/lib/services/columns";

describe("Service layer: cross-user ownership rejection", () => {
  let ownerId: string;
  let intruderId: string;
  let projectId: string;
  let columnId: string;
  let cardId: string;

  beforeEach(async () => {
    const owner = await createTestUser(`owner-${Date.now()}`);
    ownerId = owner.user.id;
    const intruder = await createTestUser(`intruder-${Date.now()}`);
    intruderId = intruder.user.id;

    const project = await createTestProject(ownerId, "Owner's Project");
    projectId = project.id;
    const column = await createTestColumn(projectId);
    columnId = column.id;
    const card = await createTestCard(projectId, columnId);
    cardId = card.id;
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(intruderId);
  });

  it("blocks a project read/update/delete by a non-owner", async () => {
    expect((await projectsService.getProjectById(projectId, intruderId)).success).toBe(false);
    expect((await projectsService.updateProject(projectId, { name: "Hacked" }, intruderId)).success).toBe(false);
    expect((await projectsService.deleteProject(projectId, intruderId)).success).toBe(false);

    const stillThere = await db.project.findUnique({ where: { id: projectId } });
    expect(stillThere?.name).toBe("Owner's Project");
  });

  it("blocks a card update/move/delete by a non-owner of its project", async () => {
    expect((await cardsService.updateCard(cardId, { title: "Hacked" }, intruderId)).success).toBe(false);
    expect((await cardsService.moveCard(cardId, columnId, 0, intruderId)).success).toBe(false);
    expect((await cardsService.deleteCard(cardId, intruderId)).success).toBe(false);

    const stillThere = await db.card.findUnique({ where: { id: cardId } });
    expect(stillThere).not.toBeNull();
  });

  it("blocks a column delete by a non-owner of its project", async () => {
    const res = await columnsService.deleteColumn(columnId, intruderId);
    expect(res.success).toBe(false);

    const stillThere = await db.column.findUnique({ where: { id: columnId } });
    expect(stillThere).not.toBeNull();
  });

  it("blocks a comment update by a non-owner of its card's project", async () => {
    const created = await commentsService.addComment(cardId, "Owner", "Original", ownerId);
    const commentId = created.data!.id;

    const res = await commentsService.updateComment(commentId, "Hacked", intruderId);
    expect(res.success).toBe(false);

    const stillThere = await db.comment.findUnique({ where: { id: commentId } });
    expect(stillThere?.content).toBe("Original");
  });

  it("blocks an attachment delete by a non-owner of its card's project", async () => {
    const uploaded = await attachmentsService.uploadAttachment(
      { cardId, filename: "secret.txt", contentBuffer: Buffer.from("secret") },
      ownerId
    );
    const attachmentId = uploaded.data!.id;

    const res = await attachmentsService.deleteAttachment(attachmentId, intruderId);
    expect(res.success).toBe(false);

    const stillThere = await db.attachment.findUnique({ where: { id: attachmentId } });
    expect(stillThere).not.toBeNull();
  });

  it("blocks deleting another user's personal label", async () => {
    const label = await labelsService.createLabel("Personal Label", "#000000", undefined, ownerId);
    const labelId = label.data!.id;

    const res = await labelsService.deleteLabel(labelId, intruderId);
    expect(res.success).toBe(false);

    const stillThere = await db.label.findUnique({ where: { id: labelId } });
    expect(stillThere).not.toBeNull();
  });

  it("blocks removing a card relation by a non-owner of the source card's project", async () => {
    const otherCard = await cardsService.createCard(
      { projectId, columnId, title: "Related Card" },
      ownerId
    );
    const relation = await relationsService.addCardRelation(cardId, otherCard.data!.id, "RELATES_TO", ownerId);
    const relationId = relation.data!.id;

    const res = await relationsService.removeCardRelation(relationId, intruderId);
    expect(res.success).toBe(false);

    const stillThere = await db.cardRelation.findUnique({ where: { id: relationId } });
    expect(stillThere).not.toBeNull();
  });
});
