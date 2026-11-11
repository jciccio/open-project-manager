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
import { validateParentCard, type CardParentReader } from "@/lib/cardParent";
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

interface RunCtx {
  importer: Importer;
  userId: string;
  source: string;
  importRunId: string;
  tally: DroppedTally;
}

interface CreateOrSkipOptions {
  mappingKey?: string;
  findLegacy?: () => Promise<string | undefined>;
  /** Runs only for a record that would be created. A returned message fails the record instead. */
  validate?: () => Promise<string | undefined>;
}

type CreateOrSkipResult = { localId?: string; result: ImportRecordResult };

/**
 * What a run does with each decision the traversal makes. The live plan writes; the dry
 * plan records the same decisions without writing, so both modes share every rule.
 */
interface ImportPlan {
  readonly records: ImportRecordResult[];
  readonly parentReader?: CardParentReader;
  createOrSkip(
    entityType: ImportEntityType,
    sourceId: string,
    create: () => Promise<string>,
    options?: CreateOrSkipOptions
  ): Promise<CreateOrSkipResult>;
  /** The local id of a record imported earlier (or planned earlier in this dry run). */
  resolve(entityType: ImportEntityType, mappingKey: string): Promise<string | undefined>;
  cardCreated(cardLocalId: string, projectLocalId: string): void;
  setParent(cardLocalId: string, parentLocalId: string): Promise<void>;
  addRelation(sourceCardId: string, targetCardId: string, type: ValidRelationType): Promise<void>;
}

interface TraversalCtx extends RunCtx {
  plan: ImportPlan;
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
async function assignableUsersByEmail(projectLocalId: string, importingUserId: string): Promise<Map<string, string>> {
  const project = await db.project.findUnique({
    where: { id: projectLocalId },
    select: { userId: true, members: { select: { userId: true } } },
  });
  // A project a dry run would create doesn't exist yet; the importing user would own it.
  const ids = [project?.userId ?? importingUserId, ...(project?.members.map((member) => member.userId) ?? [])].filter(
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

async function importCardAttachments(ctx: TraversalCtx, cardSourceId: string, cardLocalId: string) {
  const records = ctx.plan.records;
  if (!ctx.importer.fetchAttachments) return;
  try {
    for await (const attachment of ctx.importer.fetchAttachments(cardSourceId)) {
      const { result } = await ctx.plan.createOrSkip(
        "attachment",
        attachment.sourceId,
        () => storeImportedAttachment(attachment, cardLocalId),
        {
          validate: async () =>
            attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES
              ? attachmentTooLargeError(attachment.filename)
              : undefined,
        }
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
  options: CreateOrSkipOptions = {}
): Promise<CreateOrSkipResult> {
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

    const invalid = await options.validate?.();
    if (invalid) return { result: { entityType, sourceId, status: "failed", error: invalid } };

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

async function liveLocalId(ctx: RunCtx, entityType: ImportEntityType, mappingKey: string): Promise<string | undefined> {
  const existing = await findExistingMapping(ctx.userId, ctx.source, entityType, mappingKey);
  return existing && (await rowStillExists(entityType, existing.localId)) ? existing.localId : undefined;
}

function livePlan(ctx: RunCtx): ImportPlan {
  return {
    records: [],
    createOrSkip: (entityType, sourceId, create, options) => createOrSkip(ctx, entityType, sourceId, create, options),
    resolve: (entityType, mappingKey) => liveLocalId(ctx, entityType, mappingKey),
    cardCreated: () => {},
    setParent: async (cardLocalId, parentLocalId) => {
      await db.card.update({ where: { id: cardLocalId }, data: { parentId: parentLocalId } });
    },
    addRelation: async (sourceCardId, targetCardId, type) => {
      await db.cardRelation.upsert({
        where: { sourceCardId_targetCardId_type: { sourceCardId, targetCardId, type } },
        create: { sourceCardId, targetCardId, type },
        update: {},
      });
    },
  };
}

/**
 * Records the decisions a live run would make without writing anything. A record it would
 * create gets a placeholder id, and parent links it would make are kept in memory so
 * later parent checks see them, as the live run's database would.
 */
function dryPlan(ctx: RunCtx): ImportPlan {
  const planned = new Map<string, string>();
  const plannedCardProjects = new Map<string, string>();
  const plannedParents = new Map<string, string>();
  const plannedKey = (entityType: ImportEntityType, mappingKey: string) => `${entityType}:${mappingKey}`;

  const plan: ImportPlan = {
    records: [],
    parentReader: {
      childCount: async (cardId) =>
        (await db.card.count({ where: { parentId: cardId } })) +
        [...plannedParents.values()].filter((parentId) => parentId === cardId).length,
      card: async (cardId) => {
        const projectId = plannedCardProjects.get(cardId);
        if (projectId) return { projectId, parentId: plannedParents.get(cardId) ?? null };
        return db.card.findUnique({ where: { id: cardId }, select: { projectId: true, parentId: true } });
      },
    },
    resolve: async (entityType, mappingKey) =>
      planned.get(plannedKey(entityType, mappingKey)) ?? liveLocalId(ctx, entityType, mappingKey),
    createOrSkip: async (entityType, sourceId, _create, options = {}) => {
      const mappingKey = options.mappingKey ?? sourceId;
      const key = plannedKey(entityType, mappingKey);
      try {
        const skip = (localId: string): CreateOrSkipResult => ({
          localId,
          result: { entityType, sourceId, status: "skipped", localId },
        });
        const plannedId = planned.get(key);
        if (plannedId) return skip(plannedId);

        const existing = await findExistingMapping(ctx.userId, ctx.source, entityType, mappingKey);
        if (existing && (await rowStillExists(entityType, existing.localId))) return skip(existing.localId);

        const legacyLocalId = existing ? undefined : await options.findLegacy?.();
        if (legacyLocalId) {
          planned.set(key, legacyLocalId);
          return skip(legacyLocalId);
        }

        const invalid = await options.validate?.();
        if (invalid) return { result: { entityType, sourceId, status: "failed", error: invalid } };

        const localId = `planned:${key}`;
        planned.set(key, localId);
        return { localId, result: { entityType, sourceId, status: "created", localId } };
      } catch (err) {
        return {
          result: { entityType, sourceId, status: "failed", error: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    cardCreated: (cardLocalId, projectLocalId) => {
      plannedCardProjects.set(cardLocalId, projectLocalId);
    },
    setParent: async (cardLocalId, parentLocalId) => {
      plannedParents.set(cardLocalId, parentLocalId);
    },
    addRelation: async () => {},
  };
  return plan;
}

const DRY_RUN_STATUS = { created: "would_create", skipped: "would_skip", failed: "would_fail" } as const;

function asDryRunRecord(record: ImportRecordResult): ImportDryRunRecordResult {
  return {
    entityType: record.entityType,
    sourceId: record.sourceId,
    status: DRY_RUN_STATUS[record.status],
    ...(record.error !== undefined ? { error: record.error } : {}),
  };
}

async function traverseImport(ctx: TraversalCtx) {
  const records = ctx.plan.records;
  try {
    for await (const projectRec of ctx.importer.fetchProjects()) {
      try {
        const { localId: projectLocalId, result: projectResult } = await ctx.plan.createOrSkip(
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

            const { localId, result } = await ctx.plan.createOrSkip("column", col.sourceId, async () => {
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
            const { localId, result } = await ctx.plan.createOrSkip(
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
            const { localId, result } = await ctx.plan.createOrSkip(
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
        const pendingRelations: Array<{ cardLocalId: string; cardSourceId: string; relations: ImportCardRelation[] }> = [];
        const assignable = await assignableUsersByEmail(projectLocalId, ctx.userId);

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

            const validateCard = async (): Promise<string | undefined> => {
              for (const link of card.links ?? []) {
                if (!SafeUrlSchema.safeParse(link.url).success) {
                  return `Invalid link URL "${link.url}": must be a valid http, https or mailto URL`;
                }
              }
              for (const sid of card.labelSourceIds ?? []) {
                if (labelMap.has(sid)) continue;
                const earlier = await ctx.plan.resolve("label", labelMappingKey(projectRec.sourceId, sid));
                if (!earlier) return `Unknown labelSourceId "${sid}": no matching label was imported for this project`;
                labelMap.set(sid, earlier);
              }
              return undefined;
            };

            const { localId: cardLocalId, result: cardResult } = await ctx.plan.createOrSkip("card", card.sourceId, async () => {
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
                completedAt: card.completedAt ? new Date(card.completedAt) : null,
                createdAt: card.createdAt ? new Date(card.createdAt) : undefined,
                isArchived: !!card.isArchived,
                typeId: card.typeSourceId ? cardTypeMap.get(card.typeSourceId) ?? null : null,
                links:
                  card.links && card.links.length > 0
                    ? {
                        create: card.links.map((link) => ({
                          url: link.url,
                          title: link.title || null,
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
            }, { validate: validateCard });
            records.push(cardResult);
            if (!cardLocalId) continue;

            cardMap.set(card.sourceId, cardLocalId);
            if (cardResult.status === "created") {
              ctx.plan.cardCreated(cardLocalId, projectLocalId);
              ctx.tally.unmatchedAssignees += assignees.unmatched.length;
              if (card.parentSourceId) {
                pendingParents.push({ cardLocalId, cardSourceId: card.sourceId, parentSourceId: card.parentSourceId });
              }
              if (card.relations && card.relations.length > 0) {
                pendingRelations.push({ cardLocalId, cardSourceId: card.sourceId, relations: card.relations });
              }
            }

            try {
              for await (const comment of ctx.importer.fetchComments(card.sourceId)) {
                const { result: commentResult } = await ctx.plan.createOrSkip("comment", comment.sourceId, async () => {
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

            await importCardAttachments(ctx, card.sourceId, cardLocalId);
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

            const parentLocalId = cardMap.get(parentSourceId) ?? (await ctx.plan.resolve("card", parentSourceId));
            if (!parentLocalId) {
              records.push({
                entityType: "card",
                sourceId: `${cardSourceId}:parent`,
                status: "failed",
                error: `Unresolved parentSourceId "${parentSourceId}": no matching card found`,
              });
              continue;
            }

            const parentError = await validateParentCard(projectLocalId, parentLocalId, cardLocalId, ctx.plan.parentReader);
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
              await ctx.plan.setParent(cardLocalId, parentLocalId);
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
                  sourceId: `${cardSourceId}:relation:${rel.targetCardSourceId}`,
                  status: "failed",
                  error: "A card cannot relate to itself",
                });
                continue;
              }

              const targetCardLocalId =
                cardMap.get(rel.targetCardSourceId) ?? (await ctx.plan.resolve("card", rel.targetCardSourceId));
              if (!targetCardLocalId) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.targetCardSourceId}`,
                  status: "failed",
                  error: `Unresolved relation target "${rel.targetCardSourceId}": no matching card found`,
                });
                continue;
              }

              const norm = normalizeRelation(cardLocalId, targetCardLocalId, rel.type);
              if (!norm.valid) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.targetCardSourceId}`,
                  status: "failed",
                  error: norm.error,
                });
                continue;
              }

              const relKey = `${norm.sourceId}:${norm.targetId}:${norm.type}`;
              if (processedRelations.has(relKey)) {
                continue;
              }
              processedRelations.add(relKey);

              try {
                await ctx.plan.addRelation(norm.sourceId, norm.targetId, norm.type);
              } catch (err) {
                records.push({
                  entityType: "card",
                  sourceId: `${cardSourceId}:relation:${rel.targetCardSourceId}`,
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

export async function runImport(
  importer: Importer,
  userId: string,
  options: RunImportOptions = {}
): Promise<ImportSummary | ImportDryRunSummary> {
  const importRunId = options.importRunId ?? randomUUID();
  const tally: DroppedTally = { unmatchedAssignees: 0 };
  const ctx: RunCtx = { importer, userId, source: importer.name, importRunId, tally };
  const plan = options.dryRun ? dryPlan(ctx) : livePlan(ctx);
  await traverseImport({ ...ctx, plan });

  if (options.dryRun) {
    const records = plan.records.map(asDryRunRecord);
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

  const records = plan.records;

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
