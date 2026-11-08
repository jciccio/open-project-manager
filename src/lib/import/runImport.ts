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
import type {
  Importer,
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

function isValidLinkUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  return SafeUrlSchema.safeParse(url.trim()).success;
}

interface RunCtx {
  importer: Importer;
  userId: string;
  source: string;
  importRunId: string;
}

async function findExistingMapping(userId: string, source: string, entityType: ImportEntityType, sourceId: string) {
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
                  data: { projectId: projectLocalId, name: lbl.name, color: lbl.color || "#3b82f6" },
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
        const maxExplicit = cards.reduce((max, c) => (typeof c.number === "number" && Number.isInteger(c.number) && c.number > max ? c.number : max), 0);
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
        const pendingRelations: Array<{ cardLocalId: string; cardSourceId: string; relations: ImportCardRelation[] }> = [];

        try {
          for (const card of cards) {
            const { localId: cardLocalId, result: cardResult } = await createOrSkip(ctx, "card", card.sourceId, async () => {
              const columnLocalId = columnMap.get(card.columnSourceId);
              if (!columnLocalId) {
                throw new Error(unknownColumnError(card.columnSourceId));
              }

              const validLinks: ImportCardLink[] = [];
              if (card.links && card.links.length > 0) {
                for (const link of card.links) {
                  if (isValidLinkUrl(link.url)) {
                    validLinks.push(link);
                  } else {
                    records.push({
                      entityType: "card",
                      sourceId: `${card.sourceId}:link:${link.url ?? ""}`,
                      status: "failed",
                      error: `Invalid link URL "${link.url ?? ""}": must be a valid http, https or mailto URL`,
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

              const hasExplicit = typeof card.number === "number" && Number.isInteger(card.number) && card.number > 0;
              const explicitNum = hasExplicit ? card.number! : undefined;

              let finalNumber: number;
              if (explicitNum !== undefined && !existingNumbers.has(explicitNum)) {
                finalNumber = explicitNum;
                existingNumbers.add(finalNumber);
              } else {
                finalNumber = getNextAutoNumber();
              }

              const cardData = {
                projectId: projectLocalId,
                columnId: columnLocalId,
                title: card.title,
                priority: card.priority || "NONE",
                points: card.points ?? null,
                owner: card.owner ?? null,
                dueDate: parseDueDate(card.dueDate),
                completedAt: card.completedAt ? new Date(card.completedAt) : null,
                createdAt: card.createdAt ? new Date(card.createdAt) : undefined,
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

              const created = await withCardNumberRetry(projectLocalId, finalNumber, (number) => {
                let cardDescription = card.description ?? null;
                if (explicitNum !== undefined && number !== explicitNum) {
                  const note = `[Original card index: ${explicitNum}]`;
                  cardDescription = cardDescription ? `${cardDescription}\n\n${note}` : note;
                }
                return db.card.create({
                  data: {
                    ...cardData,
                    description: cardDescription,
                    number,
                    order,
                  },
                });
              });
              existingNumbers.add(created.number);
              nextNumber = Math.max(nextNumber, created.number + 1);
              return created.id;
            });
            records.push(cardResult);
            if (!cardLocalId) continue;

            cardMap.set(card.sourceId, cardLocalId);
            if (card.parentSourceId) {
              if (cardResult.status === "created") {
                pendingParents.push({ cardLocalId, cardSourceId: card.sourceId, parentSourceId: card.parentSourceId });
              } else {
                const parentRec = await findExistingMapping(ctx.userId, ctx.source, "card", `${card.sourceId}:parent`);
                if (!parentRec || !(await rowStillExists("card", parentRec.localId))) {
                  pendingParents.push({ cardLocalId, cardSourceId: card.sourceId, parentSourceId: card.parentSourceId });
                }
              }
            }
            if (card.relations && card.relations.length > 0) {
              if (cardResult.status === "created") {
                pendingRelations.push({ cardLocalId, cardSourceId: card.sourceId, relations: card.relations });
              } else {
                const neededRelations: ImportCardRelation[] = [];
                for (const rel of card.relations) {
                  const relRec = await findExistingMapping(
                    ctx.userId,
                    ctx.source,
                    "card",
                    `${card.sourceId}:relation:${rel.type}:${rel.targetCardSourceId}`
                  );
                  if (!relRec) {
                    neededRelations.push(rel);
                  }
                }
                if (neededRelations.length > 0) {
                  pendingRelations.push({ cardLocalId, cardSourceId: card.sourceId, relations: neededRelations });
                }
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
              await recordMapping(ctx.userId, ctx.source, "card", `${cardSourceId}:parent`, parentLocalId, ctx.importRunId);
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
          for (const { cardLocalId, cardSourceId, relations } of pendingRelations) {
            for (const rel of relations) {
              if (rel.targetCardSourceId === cardSourceId) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
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
                  sourceId: `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                  status: "failed",
                  error: `Unresolved relation target "${rel.targetCardSourceId}": no matching card found`,
                });
                continue;
              }

              const norm = normalizeRelation(cardLocalId, targetCardLocalId, rel.type);
              if (!norm.valid) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                  status: "failed",
                  error: norm.error,
                });
                continue;
              }

              const relKey = `${norm.sourceId}:${norm.targetId}:${norm.type}`;
              if (processedRelations.has(relKey)) {
                await recordMapping(
                  ctx.userId,
                  ctx.source,
                  "card",
                  `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                  `${norm.sourceId}:${norm.targetId}:${norm.type}`,
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
                  `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                  `${norm.sourceId}:${norm.targetId}:${norm.type}`,
                  ctx.importRunId
                );
              } catch (err) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
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
  records: ImportDryRunRecordResult[]
) {
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
            columnSourceIds.add(col.sourceId);
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

        const validCardsInRun = new Set<string>();
        const cardParentPlan = new Map<string, string>();

        try {
          for (const card of cards) {
            const cardMapping = await liveMapping("card", card.sourceId);
            if (cardMapping) {
              records.push({ entityType: "card", sourceId: card.sourceId, status: "would_skip" });
              validCardsInRun.add(card.sourceId);
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
              continue;
            }

            if (!columnSourceIds.has(card.columnSourceId)) {
              records.push({
                entityType: "card",
                sourceId: card.sourceId,
                status: "would_fail",
                error: unknownColumnError(card.columnSourceId),
              });
              continue;
            }

            if (card.links && card.links.length > 0) {
              for (const link of card.links) {
                if (!isValidLinkUrl(link.url)) {
                  records.push({
                    entityType: "card",
                    sourceId: `${card.sourceId}:link:${link.url ?? ""}`,
                    status: "would_fail",
                    error: `Invalid link URL "${link.url ?? ""}": must be a valid http, https or mailto URL`,
                  });
                }
              }
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

            validCardsInRun.add(card.sourceId);
            records.push({ entityType: "card", sourceId: card.sourceId, status: "would_create" });

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
          }

          // Second pass: resolve parents and relations for cards that exist / would_create
          for (const card of cards) {
            if (!validCardsInRun.has(card.sourceId)) continue;

            if (card.parentSourceId) {
              const alreadyLinked = await liveMapping("card", `${card.sourceId}:parent`);
              if (!alreadyLinked) {
                if (card.parentSourceId === card.sourceId) {
                  records.push({
                    entityType: "card",
                    sourceId: `${card.sourceId}:parent`,
                    status: "would_fail",
                    error: `Invalid parent "${card.parentSourceId}": A card cannot be its own parent`,
                  });
                } else {
                  const parentValid =
                    validCardsInRun.has(card.parentSourceId) ||
                    !!(await liveMapping("card", card.parentSourceId));
                  if (!parentValid) {
                    records.push({
                      entityType: "card",
                      sourceId: `${card.sourceId}:parent`,
                      status: "would_fail",
                      error: `Unresolved parentSourceId "${card.parentSourceId}": no matching card found`,
                    });
                  } else if (cardParentPlan.has(card.parentSourceId)) {
                    records.push({
                      entityType: "card",
                      sourceId: `${card.sourceId}:parent`,
                      status: "would_fail",
                      error: `Invalid parent "${card.parentSourceId}": Subtasks cannot be nested under another subtask`,
                    });
                  } else {
                    const hasChildren = Array.from(cardParentPlan.values()).includes(card.sourceId);
                    if (hasChildren) {
                      records.push({
                        entityType: "card",
                        sourceId: `${card.sourceId}:parent`,
                        status: "would_fail",
                        error: `Invalid parent "${card.parentSourceId}": A card with subtasks cannot be made a subtask`,
                      });
                    } else {
                      cardParentPlan.set(card.sourceId, card.parentSourceId);
                    }
                  }
                }
              }
            }

            if (card.relations && card.relations.length > 0) {
              for (const rel of card.relations) {
                const alreadyRel = await findExistingMapping(userId, source, "card", `${card.sourceId}:relation:${rel.type}:${rel.targetCardSourceId}`);
                if (alreadyRel) continue;

                if (rel.targetCardSourceId === card.sourceId) {
                  records.push({
                    entityType: "card",
                    sourceId: `${card.sourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                    status: "would_fail",
                    error: "A card cannot relate to itself",
                  });
                  continue;
                }

                const norm = normalizeRelation(card.sourceId, rel.targetCardSourceId, rel.type);
                if (!norm.valid) {
                  records.push({
                    entityType: "card",
                    sourceId: `${card.sourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                    status: "would_fail",
                    error: norm.error,
                  });
                  continue;
                }

                const targetValid =
                  validCardsInRun.has(rel.targetCardSourceId) ||
                  !!(await liveMapping("card", rel.targetCardSourceId));
                if (!targetValid) {
                  records.push({
                    entityType: "card",
                    sourceId: `${card.sourceId}:relation:${rel.type}:${rel.targetCardSourceId}`,
                    status: "would_fail",
                    error: `Unresolved relation target "${rel.targetCardSourceId}": no matching card found`,
                  });
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

  if (options.dryRun) {
    const records: ImportDryRunRecordResult[] = [];
    await classifyForDryRun(importer, userId, importer.name, records);
    const wouldCreate = records.filter((r) => r.status === "would_create").length;
    const wouldSkip = records.filter((r) => r.status === "would_skip").length;
    const wouldFail = records.filter((r) => r.status === "would_fail").length;
    return { mode: "dry-run", importRunId, totals: { wouldCreate, wouldSkip, wouldFail }, records };
  }

  const records: ImportRecordResult[] = [];
  await importProject({ importer, userId, source: importer.name, importRunId }, records);

  const created = records.filter((r) => r.status === "created").length;
  const skipped = records.filter((r) => r.status === "skipped").length;
  const failed = records.filter((r) => r.status === "failed").length;
  return { mode: "live", importRunId, totals: { created, skipped, failed }, records };
}
