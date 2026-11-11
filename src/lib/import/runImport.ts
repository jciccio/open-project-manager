import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_COLUMN_GROUP,
  COLUMN_GROUPS,
  resolveColumnGroup,
  type ColumnGroup,
} from "@/lib/columnGroups";
import { generateProjectKey } from "@/lib/projectKey";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { validateParentCard } from "@/lib/cardParent";
import { SafeUrlSchema } from "@/lib/validation/safeUrl";
import { removeAttachmentFiles } from "@/lib/attachmentCleanup";
import { MAX_ATTACHMENT_BYTES, writeAttachmentFile } from "@/lib/attachmentStorage";
import type {
  Importer,
  ImportAssignee,
  ImportAttachment,
  ImportDroppedField,
  ImportEntityType,
  ImportRecordResult,
  ImportDryRunRecordResult,
  ImportSummary,
  ImportDryRunSummary,
  RunImportOptions,
  ImportCardRelation,
  ImportCardLink,
  ImportCard,
} from "./types";

const ORDER_GAP = 10000;

export const VALID_RELATION_TYPES = ["BLOCKS", "BLOCKED_BY", "RELATES_TO"] as const;
export type ValidRelationType = (typeof VALID_RELATION_TYPES)[number];

export function normalizeRelation(
  sourceCardId: string,
  targetCardId: string,
  rawType: string
): { valid: false; error: string } | { valid: true; sourceId: string; targetId: string; type: ValidRelationType } {
  if (sourceCardId === targetCardId) {
    return { valid: false, error: "A card cannot relate to itself" };
  }
  const normType = (rawType || "").toUpperCase().trim();
  if (!VALID_RELATION_TYPES.includes(normType as ValidRelationType)) {
    return { valid: false, error: `Invalid relation type '${rawType}'. Expected BLOCKS, BLOCKED_BY, or RELATES_TO` };
  }
  if (normType === "BLOCKED_BY") {
    return { valid: true, sourceId: targetCardId, targetId: sourceCardId, type: "BLOCKS" };
  }
  if (normType === "RELATES_TO") {
    const [sourceId, targetId] = sourceCardId < targetCardId ? [sourceCardId, targetCardId] : [targetCardId, sourceCardId];
    return { valid: true, sourceId, targetId, type: "RELATES_TO" };
  }
  return { valid: true, sourceId: sourceCardId, targetId: targetCardId, type: "BLOCKS" };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function unknownColumnError(columnSourceId: string): string {
  return `Unknown columnSourceId "${columnSourceId}": no matching column was imported for this project`;
}

function parseDueDate(dueDate: string | undefined): Date | null {
  if (!dueDate) return null;
  const match = dueDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return new Date(`${match[1]}T00:00:00Z`);
  const d = new Date(dueDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOptionalDate(
  raw: string | undefined,
  fieldName: string
): { valid: true; date: Date | undefined } | { valid: false; error: string } {
  if (raw === undefined || raw === "") return { valid: true, date: undefined };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { valid: false, error: `Invalid ${fieldName} "${raw}": must be a valid date` };
  }
  return { valid: true, date: d };
}

function isValidLinkUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  return SafeUrlSchema.safeParse(url.trim()).success;
}

function linkFailureSourceId(cardSourceId: string, url: string | undefined | null): string {
  return `${cardSourceId}:link:${url ?? ""}`;
}

function invalidLinkError(url: string | undefined | null): string {
  return `Invalid link URL "${url ?? ""}": must be a valid http, https or mailto URL`;
}

function relationFailureSourceId(cardSourceId: string, rel: ImportCardRelation): string {
  return `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`;
}

function relationMappingValue(sourceId: string, targetId: string, type: ValidRelationType): string {
  return `${sourceId}:${targetId}:${type}`;
}

interface RunCtx {
  importer: Importer;
  userId: string;
  source: string;
  importRunId: string;
  tally: DroppedTally;
}

interface DroppedTally {
  unmatchedAssignees: number;
}

function droppedReport(importer: Importer, tally: DroppedTally): ImportDroppedField[] {
  const dropped = importer.droppedFields?.() ?? [];
  if (tally.unmatchedAssignees === 0) return dropped;
  return [
    ...dropped,
    { field: "Assignees with no matching OPM account (names kept in the card owner)", count: tally.unmatchedAssignees },
  ];
}

/** Lowercased email to user id, for the users a card in this project can be assigned to. */
async function assignableUsersByEmail(projectLocalId: string): Promise<Map<string, string>> {
  const project = await db.project.findUnique({
    where: { id: projectLocalId },
    select: { userId: true, members: { select: { userId: true } } },
  });
  const ids = [project?.userId, ...(project?.members.map((member) => member.userId) ?? [])].filter(
    (id): id is string => !!id
  );
  return usersByEmail(ids);
}

async function usersByEmail(userIds: string[]): Promise<Map<string, string>> {
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
  return new Map(users.map((user) => [user.email.toLowerCase(), user.id]));
}

function splitAssignees(assignees: ImportAssignee[] | undefined, assignable: Map<string, string>) {
  const userIds = new Set<string>();
  const unmatched: ImportAssignee[] = [];
  for (const assignee of assignees ?? []) {
    const userId = assignee.email ? assignable.get(assignee.email.toLowerCase()) : undefined;
    if (userId) userIds.add(userId);
    else unmatched.push(assignee);
  }
  return { userIds: [...userIds], unmatched };
}

function attachmentTooLargeError(filename: string): string {
  return `Attachment "${filename}" is over the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB attachment size limit`;
}

async function storeImportedAttachment(attachment: ImportAttachment, cardLocalId: string): Promise<string> {
  if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(attachmentTooLargeError(attachment.filename));
  }
  const content = await attachment.download();
  if (content.length > MAX_ATTACHMENT_BYTES) throw new Error(attachmentTooLargeError(attachment.filename));

  const storageKey = writeAttachmentFile(attachment.filename, content);
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          cardId: cardLocalId,
          filename: attachment.filename,
          storageKey,
          url: "",
          size: content.length,
          mimeType: attachment.mimeType ?? null,
          uploadedBy: attachment.uploadedBy ?? null,
          ...(attachment.createdAt ? { createdAt: new Date(attachment.createdAt) } : {}),
        },
      });
      await tx.attachment.update({ where: { id: created.id }, data: { url: `/api/v1/attachments/${created.id}` } });
      return created.id;
    });
  } catch (err) {
    await removeAttachmentFiles([storageKey]);
    throw err;
  }
}

async function importCardAttachments(
  ctx: RunCtx,
  cardSourceId: string,
  cardLocalId: string,
  records: ImportRecordResult[]
) {
  if (!ctx.importer.fetchAttachments) return;
  try {
    for await (const attachment of ctx.importer.fetchAttachments(cardSourceId)) {
      const { result } = await createOrSkip(ctx, "attachment", attachment.sourceId, () =>
        storeImportedAttachment(attachment, cardLocalId)
      );
      records.push(result);
    }
  } catch (err) {
    records.push({
      entityType: "attachment",
      sourceId: `${cardSourceId}:attachments`,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function findExistingMapping(userId: string, source: string, entityType: ImportEntityType, sourceId: string) {
  const exact = await db.importRecord.findUnique({
    where: { userId_source_entityType_sourceId: { userId, source, entityType, sourceId } },
  });
  if (exact) return exact;

  // Fallback to bare adapter name if source was namespaced (e.g. "vikunja" for legacy records)
  const bareSource = source.split(":")[0];
  if (bareSource && bareSource !== source) {
    return db.importRecord.findUnique({
      where: { userId_source_entityType_sourceId: { userId, source: bareSource, entityType, sourceId } },
    });
  }
  return null;
}

async function recordMapping(
  userId: string,
  source: string,
  entityType: ImportEntityType,
  sourceId: string,
  localId: string,
  importRunId: string
) {
  await db.importRecord.upsert({
    where: { userId_source_entityType_sourceId: { userId, source, entityType, sourceId } },
    create: { userId, source, entityType, sourceId, localId, importRunId },
    update: { localId, importRunId },
  });
}

// Imported labels are project rows, so one source label used by two projects
// needs one mapping per project.
function labelMappingKey(projectSourceId: string, labelSourceId: string): string {
  return `${projectSourceId}/${labelSourceId}`;
}

/** Mappings recorded before labels were keyed per project; reusable only within the label's own project. */
async function findLegacyLabelInProject(userId: string, source: string, labelSourceId: string, projectLocalId: string) {
  const legacy = await findExistingMapping(userId, source, "label", labelSourceId);
  if (!legacy) return undefined;
  const label = await db.label.findUnique({ where: { id: legacy.localId }, select: { projectId: true } });
  return label?.projectId === projectLocalId ? legacy.localId : undefined;
}

/** A card type with the same name already in the project (names are unique per project). */
async function findCardTypeByName(projectLocalId: string, name: string) {
  const existing = await db.cardType.findUnique({
    where: { name_projectId: { name, projectId: projectLocalId } },
    select: { id: true },
  });
  return existing?.id;
}

async function rowStillExists(entityType: ImportEntityType, localId: string): Promise<boolean> {
  switch (entityType) {
    case "project":
      return !!(await db.project.findUnique({ where: { id: localId }, select: { id: true } }));
    case "column":
      return !!(await db.column.findUnique({ where: { id: localId }, select: { id: true } }));
    case "cardType":
      return !!(await db.cardType.findUnique({ where: { id: localId }, select: { id: true } }));
    case "label":
      return !!(await db.label.findUnique({ where: { id: localId }, select: { id: true } }));
    case "card":
      return !!(await db.card.findUnique({ where: { id: localId }, select: { id: true } }));
    case "comment":
      return !!(await db.comment.findUnique({ where: { id: localId }, select: { id: true } }));
    case "attachment":
      return !!(await db.attachment.findUnique({ where: { id: localId }, select: { id: true } }));
  }
}

async function deleteImportedRow(entityType: ImportEntityType, localId: string): Promise<void> {
  switch (entityType) {
    case "project":
      await db.project.delete({ where: { id: localId } });
      return;
    case "column":
      await db.column.delete({ where: { id: localId } });
      return;
    case "cardType":
      await db.cardType.delete({ where: { id: localId } });
      return;
    case "label":
      await db.label.delete({ where: { id: localId } });
      return;
    case "card":
      await db.card.delete({ where: { id: localId } });
      return;
    case "comment":
      await db.comment.delete({ where: { id: localId } });
      return;
    case "attachment": {
      const { storageKey } = await db.attachment.delete({ where: { id: localId } });
      await removeAttachmentFiles([storageKey]);
      return;
    }
  }
}

/** Creates a record via `create()` unless it's already mapped and the target row is still alive. */
async function createOrSkip(
  ctx: RunCtx,
  entityType: ImportEntityType,
  sourceId: string,
  create: () => Promise<string>,
  options: { mappingKey?: string; findLegacy?: () => Promise<string | undefined> } = {}
): Promise<{ localId?: string; result: ImportRecordResult }> {
  const mappingKey = options.mappingKey ?? sourceId;
  try {
    const existing = await findExistingMapping(ctx.userId, ctx.source, entityType, mappingKey);
    if (existing && (await rowStillExists(entityType, existing.localId))) {
      return {
        localId: existing.localId,
        result: { entityType, sourceId, status: "skipped", localId: existing.localId },
      };
    }

    const legacyLocalId = existing ? undefined : await options.findLegacy?.();
    if (legacyLocalId) {
      await recordMapping(ctx.userId, ctx.source, entityType, mappingKey, legacyLocalId, ctx.importRunId);
      return {
        localId: legacyLocalId,
        result: { entityType, sourceId, status: "skipped", localId: legacyLocalId },
      };
    }

    const localId = await create();
    try {
      if (existing) {
        await recordMapping(ctx.userId, ctx.source, entityType, mappingKey, localId, ctx.importRunId);
      } else {
        await db.importRecord.create({
          data: { userId: ctx.userId, source: ctx.source, entityType, sourceId: mappingKey, localId, importRunId: ctx.importRunId },
        });
      }
    } catch (err) {
      // An unmapped row would be created again on the next run.
      await deleteImportedRow(entityType, localId).catch(() => {});
      // A concurrent run mapped this record first: its row stands, ours is gone.
      const winner = isUniqueViolation(err)
        ? await findExistingMapping(ctx.userId, ctx.source, entityType, mappingKey)
        : null;
      if (winner) {
        return { localId: winner.localId, result: { entityType, sourceId, status: "skipped", localId: winner.localId } };
      }
      throw err;
    }
    return { localId, result: { entityType, sourceId, status: "created", localId } };
  } catch (err) {
    return {
      result: { entityType, sourceId, status: "failed", error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function importProject(ctx: RunCtx, records: ImportRecordResult[]) {
  try {
    for await (const projectRec of ctx.importer.fetchProjects()) {
      try {
        const { localId: projectLocalId, result: projectResult } = await createOrSkip(
          ctx,
          "project",
          projectRec.sourceId,
          async () => {
            const key = await generateProjectKey(projectRec.name, projectRec.key, ctx.userId);
            const project = await db.project.create({
              data: {
                userId: ctx.userId,
                name: projectRec.name,
                description: projectRec.description,
                color: projectRec.color || "#6366f1",
                key,
              },
            });
            return project.id;
          }
        );
        records.push(projectResult);
        if (!projectLocalId) continue;

        const columnMap = new Map<string, string>();
        try {
          for await (const col of ctx.importer.fetchColumns(projectRec.sourceId)) {
            if (col.group !== undefined && !(COLUMN_GROUPS as readonly string[]).includes(col.group)) {
              records.push({
                entityType: "column",
                sourceId: col.sourceId,
                status: "failed",
                error: `Invalid column group "${col.group}". Expected one of: ${COLUMN_GROUPS.join(", ")}`,
              });
              continue;
            }
            const groupRes = resolveColumnGroup(
              { group: col.group as ColumnGroup | undefined, isDone: col.isDone },
              DEFAULT_COLUMN_GROUP
            );
            if (!groupRes.success) {
              records.push({
                entityType: "column",
                sourceId: col.sourceId,
                status: "failed",
                error: groupRes.error,
              });
              continue;
            }

            const { localId, result } = await createOrSkip(ctx, "column", col.sourceId, async () => {
              const created = await db.column.create({
                data: {
                  projectId: projectLocalId,
                  name: col.name,
                  order: col.order ?? 0,
                  isDone: groupRes.isDone,
                  group: groupRes.group,
                  color: col.color ?? null,
                  description: col.description ?? null,
                },
              });
              return created.id;
            });
            records.push(result);
            if (localId) columnMap.set(col.sourceId, localId);
          }
        } catch (err) {
          records.push({
            entityType: "column",
            sourceId: `${projectRec.sourceId}:columns`,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const cardTypeMap = new Map<string, string>();
        try {
          for await (const ct of ctx.importer.fetchCardTypes(projectRec.sourceId)) {
            const { localId, result } = await createOrSkip(
              ctx,
              "cardType",
              ct.sourceId,
              async () => {
                const created = await db.cardType.create({
                  data: { projectId: projectLocalId, name: ct.name, icon: ct.icon || "Tag", color: ct.color || "#6366f1" },
                });
                return created.id;
              },
              { findLegacy: () => findCardTypeByName(projectLocalId, ct.name) }
            );
            records.push(result);
            if (localId) cardTypeMap.set(ct.sourceId, localId);
          }
        } catch (err) {
          records.push({
            entityType: "cardType",
            sourceId: `${projectRec.sourceId}:cardTypes`,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const labelMap = new Map<string, string>();
        try {
          for await (const lbl of ctx.importer.fetchLabels(projectRec.sourceId)) {
            const { localId, result } = await createOrSkip(
              ctx,
              "label",
              lbl.sourceId,
              async () => {
                const created = await db.label.create({
                  data: {
                    projectId: projectLocalId,
                    name: lbl.name,
                    color: lbl.color || "#3b82f6",
                    description: lbl.description ?? null,
                  },
                });
                return created.id;
              },
              {
                mappingKey: labelMappingKey(projectRec.sourceId, lbl.sourceId),
                findLegacy: () => findLegacyLabelInProject(ctx.userId, ctx.source, lbl.sourceId, projectLocalId),
              }
            );
            records.push(result);
            if (localId) labelMap.set(lbl.sourceId, localId);
          }
        } catch (err) {
          records.push({
            entityType: "label",
            sourceId: `${projectRec.sourceId}:labels`,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const cards: ImportCard[] = [];
        try {
          for await (const card of ctx.importer.fetchCards(projectRec.sourceId)) {
            cards.push(card);
          }
        } catch (err) {
          records.push({
            entityType: "card",
            sourceId: `${projectRec.sourceId}:cards`,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
          if (cards.length === 0) continue;
        }

        const existingCards = await db.card.findMany({
          where: { projectId: projectLocalId },
          select: { number: true },
        });
        const existingNumbers = new Set<number>(existingCards.map((c) => c.number));
        const maxExplicit = cards.reduce((max, c) => (c.number !== undefined && c.number > max ? c.number : max), 0);
        const maxDbNumber = existingCards.reduce((max, c) => (c.number > max ? c.number : max), 0);
        let nextNumber = Math.max(maxDbNumber, maxExplicit) + 1;

        const getNextAutoNumber = (): number => {
          const num = nextNumber++;
          existingNumbers.add(num);
          return num;
        };

        const columnMaxOrder = new Map<string, number>();
        const cardMap = new Map<string, string>();
        const pendingParents: Array<{ cardLocalId: string; cardSourceId: string; parentSourceId: string }> = [];
        const pendingRelations: Array<{
          cardLocalId: string;
          cardSourceId: string;
          relations: ImportCardRelation[];
          isSkippedCard: boolean;
        }> = [];
        const assignable = await assignableUsersByEmail(projectLocalId);

        try {
          for (const card of cards) {
            const assignees = splitAssignees(card.assignees, assignable);
            const columnLocalId = columnMap.get(card.columnSourceId);
            if (!columnLocalId) {
              records.push({
                entityType: "card",
                sourceId: card.sourceId,
                status: "failed",
                error: unknownColumnError(card.columnSourceId),
              });
              continue;
            }

            const { localId: cardLocalId, result: cardResult } = await createOrSkip(ctx, "card", card.sourceId, async () => {
              const createdAtRes = parseOptionalDate(card.createdAt, "createdAt");
              if (!createdAtRes.valid) {
                throw new Error(createdAtRes.error);
              }
              const completedAtRes = parseOptionalDate(card.completedAt, "completedAt");
              if (!completedAtRes.valid) {
                throw new Error(completedAtRes.error);
              }

              const validLinks: ImportCardLink[] = [];
              if (card.links && card.links.length > 0) {
                for (const link of card.links) {
                  if (isValidLinkUrl(link.url)) {
                    validLinks.push(link);
                  } else {
                    records.push({
                      entityType: "card",
                      sourceId: linkFailureSourceId(card.sourceId, link.url),
                      status: "failed",
                      error: invalidLinkError(link.url),
                    });
                  }
                }
              }

              if (card.labelSourceIds && card.labelSourceIds.length > 0) {
                for (const sid of card.labelSourceIds) {
                  if (!labelMap.has(sid)) {
                    const legacy = await findExistingMapping(ctx.userId, ctx.source, "label", labelMappingKey(projectRec.sourceId, sid));
                    if (legacy && (await rowStillExists("label", legacy.localId))) {
                      labelMap.set(sid, legacy.localId);
                    } else {
                      throw new Error(`Unknown labelSourceId "${sid}": no matching label was imported for this project`);
                    }
                  }
                }
              }

              if (!columnMaxOrder.has(columnLocalId)) {
                const lastCard = await db.card.findFirst({
                  where: { columnId: columnLocalId },
                  orderBy: { order: "desc" },
                  select: { order: true },
                });
                columnMaxOrder.set(columnLocalId, lastCard ? lastCard.order : 0);
              }
              const order = columnMaxOrder.get(columnLocalId)! + ORDER_GAP;
              columnMaxOrder.set(columnLocalId, order);

              let finalNumber: number;
              let description = card.description ?? null;
              if (card.number !== undefined && !existingNumbers.has(card.number)) {
                finalNumber = card.number;
                existingNumbers.add(finalNumber);
              } else {
                if (card.number !== undefined && existingNumbers.has(card.number)) {
                  const note = `[Original card index: ${card.number}]`;
                  description = description ? `${description}\n\n${note}` : note;
                }
                finalNumber = getNextAutoNumber();
              }

              const cardData = {
                projectId: projectLocalId,
                columnId: columnLocalId,
                title: card.title,
                description,
                priority: card.priority || "NONE",
                points: card.points ?? null,
                owner: [card.owner, ...assignees.unmatched.map((a) => a.name)].filter(Boolean).join(", ") || null,
                assignees:
                  assignees.userIds.length > 0
                    ? { create: assignees.userIds.map((userId) => ({ userId })) }
                    : undefined,
                dueDate: parseDueDate(card.dueDate),
                completedAt: completedAtRes.date ?? null,
                createdAt: createdAtRes.date,
                isArchived: !!card.isArchived,
                typeId: card.typeSourceId ? cardTypeMap.get(card.typeSourceId) ?? null : null,
                links:
                  validLinks.length > 0
                    ? {
                        create: validLinks.map((link) => ({
                          url: link.url.trim(),
                          title: link.title ? link.title.trim() : null,
                        })),
                      }
                    : undefined,
                labels:
                  card.labelSourceIds && card.labelSourceIds.length > 0
                    ? {
                        create: card.labelSourceIds
                          .map((sid) => labelMap.get(sid))
                          .filter((id): id is string => !!id)
                          .map((labelId) => ({ labelId })),
                      }
                    : undefined,
              };

              const created = await withCardNumberRetry(projectLocalId, finalNumber, (number) =>
                db.card.create({
                  data: {
                    ...cardData,
                    number,
                    order,
                  },
                })
              );
              existingNumbers.add(created.number);
              nextNumber = Math.max(nextNumber, created.number + 1);
              return created.id;
            });
            records.push(cardResult);
            if (!cardLocalId) continue;

            cardMap.set(card.sourceId, cardLocalId);
            if (cardResult.status === "created") {
              ctx.tally.unmatchedAssignees += assignees.unmatched.length;
              if (card.parentSourceId) {
                pendingParents.push({ cardLocalId, cardSourceId: card.sourceId, parentSourceId: card.parentSourceId });
              }
              if (card.relations && card.relations.length > 0) {
                pendingRelations.push({
                  cardLocalId,
                  cardSourceId: card.sourceId,
                  relations: card.relations,
                  isSkippedCard: false,
                });
              }
            } else {
              if (card.parentSourceId) {
                const parentRec = await findExistingMapping(ctx.userId, ctx.source, "card", `${card.sourceId}:parent`);
                if (!parentRec || !(await rowStillExists("card", parentRec.localId))) {
                  const existingCard = await db.card.findUnique({
                    where: { id: cardLocalId },
                    select: { parentId: true },
                  });
                  if (existingCard && existingCard.parentId === null) {
                    pendingParents.push({ cardLocalId, cardSourceId: card.sourceId, parentSourceId: card.parentSourceId });
                  }
                }
              }
              if (card.relations && card.relations.length > 0) {
                pendingRelations.push({
                  cardLocalId,
                  cardSourceId: card.sourceId,
                  relations: card.relations,
                  isSkippedCard: true,
                });
              }
            }

            try {
              for await (const comment of ctx.importer.fetchComments(card.sourceId)) {
                const { result: commentResult } = await createOrSkip(ctx, "comment", comment.sourceId, async () => {
                  const created = await db.comment.create({
                    data: {
                      cardId: cardLocalId,
                      author: comment.author,
                      content: comment.content,
                      ...(comment.createdAt ? { createdAt: new Date(comment.createdAt) } : {}),
                    },
                  });
                  return created.id;
                });
                records.push(commentResult);
              }
            } catch (err) {
              records.push({
                entityType: "comment",
                sourceId: `${card.sourceId}:comments`,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            }

            await importCardAttachments(ctx, card.sourceId, cardLocalId, records);
          }

          for (const { cardLocalId, cardSourceId, parentSourceId } of pendingParents) {
            if (parentSourceId === cardSourceId) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "failed",
                error: `Invalid parent "${parentSourceId}": A card cannot be its own parent`,
              });
              continue;
            }

            let parentLocalId = cardMap.get(parentSourceId);
            if (!parentLocalId) {
              const mapped = await findExistingMapping(ctx.userId, ctx.source, "card", parentSourceId);
              if (mapped && (await rowStillExists("card", mapped.localId))) {
                parentLocalId = mapped.localId;
              }
            }
            if (!parentLocalId) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "failed",
                error: `Unresolved parentSourceId "${parentSourceId}": no matching card found`,
              });
              continue;
            }

            const parentError = await validateParentCard(projectLocalId, parentLocalId, cardLocalId);
            if (parentError) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "failed",
                error: `Invalid parent "${parentSourceId}": ${parentError}`,
              });
              continue;
            }

            try {
              await db.card.update({
                where: { id: cardLocalId },
                data: { parentId: parentLocalId },
              });
              await recordMapping(
                ctx.userId,
                ctx.source,
                "card",
                `${cardSourceId}:parent`,
                parentLocalId,
                ctx.importRunId
              );
            } catch (err) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          const processedRelations = new Set<string>();
          for (const { cardLocalId, cardSourceId, relations, isSkippedCard } of pendingRelations) {
            for (const rel of relations) {
              const relSourceId = relationFailureSourceId(cardSourceId, rel);
              if (rel.targetCardSourceId === cardSourceId) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "failed",
                  error: "A card cannot relate to itself",
                });
                continue;
              }

              let targetCardLocalId = cardMap.get(rel.targetCardSourceId);
              if (!targetCardLocalId) {
                const mapped = await findExistingMapping(ctx.userId, ctx.source, "card", rel.targetCardSourceId);
                if (mapped && (await rowStillExists("card", mapped.localId))) {
                  targetCardLocalId = mapped.localId;
                }
              }
              if (!targetCardLocalId) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "failed",
                  error: `Unresolved relation target "${rel.targetCardSourceId}": no matching card found`,
                });
                continue;
              }

              const norm = normalizeRelation(cardLocalId, targetCardLocalId, rel.type);
              if (!norm.valid) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "failed",
                  error: norm.error,
                });
                continue;
              }

              const relKey = relationMappingValue(norm.sourceId, norm.targetId, norm.type);
              if (isSkippedCard) {
                const relRec = await findExistingMapping(ctx.userId, ctx.source, "card", relSourceId);
                if (relRec && relRec.localId === relKey) {
                  continue;
                }
              }

              if (processedRelations.has(relKey)) {
                await recordMapping(
                  ctx.userId,
                  ctx.source,
                  "card",
                  relSourceId,
                  relKey,
                  ctx.importRunId
                );
                continue;
              }
              processedRelations.add(relKey);

              try {
                await db.cardRelation.upsert({
                  where: {
                    sourceCardId_targetCardId_type: {
                      sourceCardId: norm.sourceId,
                      targetCardId: norm.targetId,
                      type: norm.type,
                    },
                  },
                  create: {
                    sourceCardId: norm.sourceId,
                    targetCardId: norm.targetId,
                    type: norm.type,
                  },
                  update: {},
                });
                await recordMapping(
                  ctx.userId,
                  ctx.source,
                  "card",
                  relSourceId,
                  relKey,
                  ctx.importRunId
                );
              } catch (err) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "failed",
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        } catch (err) {
          records.push({
            entityType: "card",
            sourceId: `${projectRec.sourceId}:cards`,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        records.push({
          entityType: "project",
          sourceId: projectRec.sourceId,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    records.push({
      entityType: "project",
      sourceId: "projects",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function classifyForDryRun(
  importer: Importer,
  userId: string,
  source: string,
  records: ImportDryRunRecordResult[],
  tally: DroppedTally
) {
  const dryRunKnownCards = new Map<string, { projectSourceId: string; localId: string | null }>();

  async function liveMapping(entityType: ImportEntityType, mappingKey: string) {
    const existing = await findExistingMapping(userId, source, entityType, mappingKey);
    return existing && (await rowStillExists(entityType, existing.localId)) ? existing : undefined;
  }

  async function classify(entityType: ImportEntityType, sourceId: string) {
    const alreadyImported = !!(await liveMapping(entityType, sourceId));
    records.push({ entityType, sourceId, status: alreadyImported ? "would_skip" : "would_create" });
  }

  try {
    for await (const project of importer.fetchProjects()) {
      try {
        const projectMapping = await liveMapping("project", project.sourceId);
        records.push({ entityType: "project", sourceId: project.sourceId, status: projectMapping ? "would_skip" : "would_create" });
        const columnSourceIds = new Set<string>();
        try {
          for await (const col of importer.fetchColumns(project.sourceId)) {
            columnSourceIds.add(col.sourceId);
            if (col.group !== undefined && !(COLUMN_GROUPS as readonly string[]).includes(col.group)) {
              records.push({
                entityType: "column",
                sourceId: col.sourceId,
                status: "would_fail",
                error: `Invalid column group "${col.group}". Expected one of: ${COLUMN_GROUPS.join(", ")}`,
              });
              continue;
            }
            const groupRes = resolveColumnGroup(
              { group: col.group as ColumnGroup | undefined, isDone: col.isDone },
              DEFAULT_COLUMN_GROUP
            );
            if (!groupRes.success) {
              records.push({
                entityType: "column",
                sourceId: col.sourceId,
                status: "would_fail",
                error: groupRes.error,
              });
              continue;
            }
            await classify("column", col.sourceId);
          }
        } catch (err) {
          records.push({
            entityType: "column",
            sourceId: `${project.sourceId}:columns`,
            status: "would_fail",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        try {
          for await (const ct of importer.fetchCardTypes(project.sourceId)) {
            const mapped = !!(await liveMapping("cardType", ct.sourceId));
            const sameName = !mapped && projectMapping ? !!(await findCardTypeByName(projectMapping.localId, ct.name)) : false;
            records.push({ entityType: "cardType", sourceId: ct.sourceId, status: mapped || sameName ? "would_skip" : "would_create" });
          }
        } catch (err) {
          records.push({
            entityType: "cardType",
            sourceId: `${project.sourceId}:cardTypes`,
            status: "would_fail",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const labelSourceIds = new Set<string>();
        try {
          for await (const lbl of importer.fetchLabels(project.sourceId)) {
            labelSourceIds.add(lbl.sourceId);
            const mapped = !!(await liveMapping("label", labelMappingKey(project.sourceId, lbl.sourceId)));
            const legacy =
              !mapped && projectMapping
                ? !!(await findLegacyLabelInProject(userId, source, lbl.sourceId, projectMapping.localId))
                : false;
            records.push({ entityType: "label", sourceId: lbl.sourceId, status: mapped || legacy ? "would_skip" : "would_create" });
          }
        } catch (err) {
          records.push({
            entityType: "label",
            sourceId: `${project.sourceId}:labels`,
            status: "would_fail",
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const cards: ImportCard[] = [];
        try {
          for await (const card of importer.fetchCards(project.sourceId)) {
            cards.push(card);
          }
        } catch (err) {
          records.push({
            entityType: "card",
            sourceId: `${project.sourceId}:cards`,
            status: "would_fail",
            error: err instanceof Error ? err.message : String(err),
          });
          if (cards.length === 0) continue;
        }

        const assignable = projectMapping
          ? await assignableUsersByEmail(projectMapping.localId)
          : await usersByEmail([userId]);
        const validCardSourceIds = new Set<string>();
        const dryCardLocalIds = new Map<string, string | null>();
        const dryPendingParents: Array<{
          cardLocalId: string | undefined;
          cardSourceId: string;
          parentSourceId: string;
        }> = [];
        const dryPendingRelations: Array<{
          cardLocalId: string | undefined;
          cardSourceId: string;
          relations: ImportCardRelation[];
        }> = [];

        try {
          for (const card of cards) {
            if (!columnSourceIds.has(card.columnSourceId)) {
              records.push({
                entityType: "card",
                sourceId: card.sourceId,
                status: "would_fail",
                error: unknownColumnError(card.columnSourceId),
              });
              continue;
            }

            const cardMapping = await liveMapping("card", card.sourceId);

            if (!cardMapping) {
              const createdAtRes = parseOptionalDate(card.createdAt, "createdAt");
              if (!createdAtRes.valid) {
                records.push({
                  entityType: "card",
                  sourceId: card.sourceId,
                  status: "would_fail",
                  error: createdAtRes.error,
                });
                continue;
              }
              const completedAtRes = parseOptionalDate(card.completedAt, "completedAt");
              if (!completedAtRes.valid) {
                records.push({
                  entityType: "card",
                  sourceId: card.sourceId,
                  status: "would_fail",
                  error: completedAtRes.error,
                });
                continue;
              }

              if (card.labelSourceIds && card.labelSourceIds.length > 0) {
                let unknownSid: string | undefined;
                for (const sid of card.labelSourceIds) {
                  if (!labelSourceIds.has(sid)) {
                    const mapped = await liveMapping("label", labelMappingKey(project.sourceId, sid));
                    if (!mapped) {
                      unknownSid = sid;
                      break;
                    }
                  }
                }
                if (unknownSid) {
                  records.push({
                    entityType: "card",
                    sourceId: card.sourceId,
                    status: "would_fail",
                    error: `Unknown labelSourceId "${unknownSid}": no matching label was imported for this project`,
                  });
                  continue;
                }
              }

              if (card.links && card.links.length > 0) {
                for (const link of card.links) {
                  if (!isValidLinkUrl(link.url)) {
                    records.push({
                      entityType: "card",
                      sourceId: linkFailureSourceId(card.sourceId, link.url),
                      status: "would_fail",
                      error: invalidLinkError(link.url),
                    });
                  }
                }
              }
            }

            validCardSourceIds.add(card.sourceId);
            dryCardLocalIds.set(card.sourceId, cardMapping?.localId ?? null);
            dryRunKnownCards.set(card.sourceId, {
              projectSourceId: project.sourceId,
              localId: cardMapping?.localId ?? null,
            });
            records.push({
              entityType: "card",
              sourceId: card.sourceId,
              status: cardMapping ? "would_skip" : "would_create",
            });
            if (card.assignees?.length && !cardMapping) {
              tally.unmatchedAssignees += splitAssignees(card.assignees, assignable).unmatched.length;
            }

            if (card.parentSourceId) {
              if (!cardMapping) {
                dryPendingParents.push({
                  cardLocalId: undefined,
                  cardSourceId: card.sourceId,
                  parentSourceId: card.parentSourceId,
                });
              } else {
                const parentRec = await findExistingMapping(userId, source, "card", `${card.sourceId}:parent`);
                if (!parentRec || !(await rowStillExists("card", parentRec.localId))) {
                  const existingCard = await db.card.findUnique({
                    where: { id: cardMapping.localId },
                    select: { parentId: true },
                  });
                  if (existingCard && existingCard.parentId === null) {
                    dryPendingParents.push({
                      cardLocalId: cardMapping.localId,
                      cardSourceId: card.sourceId,
                      parentSourceId: card.parentSourceId,
                    });
                  }
                }
              }
            }

            if (card.relations && card.relations.length > 0) {
              dryPendingRelations.push({
                cardLocalId: cardMapping?.localId,
                cardSourceId: card.sourceId,
                relations: card.relations,
              });
            }

            try {
              for await (const comment of importer.fetchComments(card.sourceId)) {
                await classify("comment", comment.sourceId);
              }
            } catch (err) {
              records.push({
                entityType: "comment",
                sourceId: `${card.sourceId}:comments`,
                status: "would_fail",
                error: err instanceof Error ? err.message : String(err),
              });
            }

            if (importer.fetchAttachments) {
              try {
                for await (const attachment of importer.fetchAttachments(card.sourceId)) {
                  if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
                    records.push({
                      entityType: "attachment",
                      sourceId: attachment.sourceId,
                      status: "would_fail",
                      error: attachmentTooLargeError(attachment.filename),
                    });
                  } else {
                    await classify("attachment", attachment.sourceId);
                  }
                }
              } catch (err) {
                records.push({
                  entityType: "attachment",
                  sourceId: `${card.sourceId}:attachments`,
                  status: "would_fail",
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          const simulatedParentOf = new Map<string, string>();
          const simulatedChildrenOf = new Map<string, Set<string>>();

          for (const { cardLocalId, cardSourceId, parentSourceId } of dryPendingParents) {
            if (parentSourceId === cardSourceId) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "would_fail",
                error: `Invalid parent "${parentSourceId}": A card cannot be its own parent`,
              });
              continue;
            }

            let parentLocalId: string | null = null;
            let parentFromOtherProject = false;
            let parentResolved = false;

            if (validCardSourceIds.has(parentSourceId)) {
              parentResolved = true;
              parentLocalId = dryCardLocalIds.get(parentSourceId) ?? null;
            } else {
              const priorRunCard = dryRunKnownCards.get(parentSourceId);
              if (priorRunCard) {
                parentResolved = true;
                parentLocalId = priorRunCard.localId;
                parentFromOtherProject = priorRunCard.projectSourceId !== project.sourceId;
              } else {
                const mappedParent = await liveMapping("card", parentSourceId);
                if (mappedParent) {
                  parentResolved = true;
                  parentLocalId = mappedParent.localId;
                }
              }
            }

            if (!parentResolved) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "would_fail",
                error: `Unresolved parentSourceId "${parentSourceId}": no matching card found`,
              });
              continue;
            }

            const cardNodeKey = cardLocalId ?? `batch:${cardSourceId}`;
            const parentNodeKey = parentLocalId ?? `batch:${parentSourceId}`;

            let parentError: string | null = null;
            const hasSimChildren = (simulatedChildrenOf.get(cardNodeKey)?.size ?? 0) > 0;
            const hasDbChildren = cardLocalId
              ? (await db.card.count({ where: { parentId: cardLocalId } })) > 0
              : false;
            if (hasSimChildren || hasDbChildren) {
              parentError = "A card with subtasks cannot be made a subtask";
            } else if (parentFromOtherProject) {
              parentError = "Parent card not found in this project";
            } else if (parentLocalId) {
              const dbParent = await db.card.findUnique({
                where: { id: parentLocalId },
                select: { id: true, projectId: true, parentId: true },
              });
              if (!dbParent || dbParent.projectId !== projectMapping?.localId) {
                parentError = "Parent card not found in this project";
              } else if (dbParent.parentId !== null || simulatedParentOf.has(parentNodeKey)) {
                parentError = "Subtasks cannot be nested under another subtask";
              }
            } else if (simulatedParentOf.has(parentNodeKey)) {
              parentError = "Subtasks cannot be nested under another subtask";
            }

            if (parentError) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "would_fail",
                error: `Invalid parent "${parentSourceId}": ${parentError}`,
              });
              continue;
            }

            simulatedParentOf.set(cardNodeKey, parentNodeKey);
            let children = simulatedChildrenOf.get(parentNodeKey);
            if (!children) {
              children = new Set<string>();
              simulatedChildrenOf.set(parentNodeKey, children);
            }
            children.add(cardNodeKey);
          }

          for (const { cardLocalId, cardSourceId, relations } of dryPendingRelations) {
            for (const rel of relations) {
              const relSourceId = relationFailureSourceId(cardSourceId, rel);
              if (rel.targetCardSourceId === cardSourceId) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "would_fail",
                  error: "A card cannot relate to itself",
                });
                continue;
              }

              let targetLocalId: string | null = null;
              let targetResolved = false;

              if (validCardSourceIds.has(rel.targetCardSourceId)) {
                targetResolved = true;
                targetLocalId = dryCardLocalIds.get(rel.targetCardSourceId) ?? null;
              } else {
                const priorRunCard = dryRunKnownCards.get(rel.targetCardSourceId);
                if (priorRunCard) {
                  targetResolved = true;
                  targetLocalId = priorRunCard.localId;
                } else {
                  const targetMapping = await liveMapping("card", rel.targetCardSourceId);
                  if (targetMapping) {
                    targetResolved = true;
                    targetLocalId = targetMapping.localId;
                  }
                }
              }

              if (!targetResolved) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "would_fail",
                  error: `Unresolved relation target "${rel.targetCardSourceId}": no matching card found`,
                });
                continue;
              }

              const sourceNodeKey = cardLocalId ?? `batch:${cardSourceId}`;
              const targetNodeKey = targetLocalId ?? `batch:${rel.targetCardSourceId}`;
              const norm = normalizeRelation(sourceNodeKey, targetNodeKey, rel.type);
              if (!norm.valid) {
                records.push({
                  entityType: "card",
                  sourceId: relSourceId,
                  status: "would_fail",
                  error: norm.error,
                });
                continue;
              }

              if (cardLocalId && targetLocalId) {
                const relRec = await findExistingMapping(userId, source, "card", relSourceId);
                if (relRec && relRec.localId === relationMappingValue(norm.sourceId, norm.targetId, norm.type)) {
                  continue;
                }
              }
            }
          }
        } catch (err) {
          records.push({
            entityType: "card",
            sourceId: `${project.sourceId}:cards`,
            status: "would_fail",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch (err) {
        records.push({
          entityType: "project",
          sourceId: project.sourceId,
          status: "would_fail",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    records.push({
      entityType: "project",
      sourceId: "projects",
      status: "would_fail",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runImport(
  importer: Importer,
  userId: string,
  options: RunImportOptions = {}
): Promise<ImportSummary | ImportDryRunSummary> {
  const importRunId = options.importRunId ?? randomUUID();
  const tally: DroppedTally = { unmatchedAssignees: 0 };

  if (options.dryRun) {
    const records: ImportDryRunRecordResult[] = [];
    await classifyForDryRun(importer, userId, importer.name, records, tally);
    const wouldCreate = records.filter((r) => r.status === "would_create").length;
    const wouldSkip = records.filter((r) => r.status === "would_skip").length;
    const wouldFail = records.filter((r) => r.status === "would_fail").length;
    return {
      mode: "dry-run",
      importRunId,
      totals: { wouldCreate, wouldSkip, wouldFail },
      records,
      dropped: droppedReport(importer, tally),
    };
  }

  const records: ImportRecordResult[] = [];
  await importProject({ importer, userId, source: importer.name, importRunId, tally }, records);

  const created = records.filter((r) => r.status === "created").length;
  const skipped = records.filter((r) => r.status === "skipped").length;
  const failed = records.filter((r) => r.status === "failed").length;
  return {
    mode: "live",
    importRunId,
    totals: { created, skipped, failed },
    records,
    dropped: droppedReport(importer, tally),
  };
}
