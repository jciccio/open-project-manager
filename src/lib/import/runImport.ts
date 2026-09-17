import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { generateProjectKey } from "@/lib/projectKey";
import type {
  Importer,
  ImportEntityType,
  ImportRecordResult,
  ImportDryRunRecordResult,
  ImportSummary,
  ImportDryRunSummary,
  RunImportOptions,
} from "./types";

const ORDER_GAP = 10000;

interface RunCtx {
  importer: Importer;
  userId: string;
  source: string;
  importRunId: string;
}

async function findExistingMapping(userId: string, source: string, entityType: ImportEntityType, sourceId: string) {
  return db.importRecord.findUnique({
    where: { userId_source_entityType_sourceId: { userId, source, entityType, sourceId } },
  });
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

/** Creates a record via `create()` unless it's already mapped and the target row is still alive. */
async function createOrSkip(
  ctx: RunCtx,
  entityType: ImportEntityType,
  sourceId: string,
  create: () => Promise<string>
): Promise<{ localId?: string; result: ImportRecordResult }> {
  try {
    const existing = await findExistingMapping(ctx.userId, ctx.source, entityType, sourceId);
    if (existing && (await rowStillExists(entityType, existing.localId))) {
      return {
        localId: existing.localId,
        result: { entityType, sourceId, status: "skipped", localId: existing.localId },
      };
    }

    const localId = await create();
    await recordMapping(ctx.userId, ctx.source, entityType, sourceId, localId, ctx.importRunId);
    return { localId, result: { entityType, sourceId, status: "created", localId } };
  } catch (err) {
    return {
      result: { entityType, sourceId, status: "failed", error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function importProject(ctx: RunCtx, records: ImportRecordResult[]) {
  for await (const projectRec of ctx.importer.fetchProjects()) {
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
    for await (const col of ctx.importer.fetchColumns(projectRec.sourceId)) {
      const { localId, result } = await createOrSkip(ctx, "column", col.sourceId, async () => {
        const created = await db.column.create({
          data: { projectId: projectLocalId, name: col.name, order: col.order ?? 0, isDone: col.isDone ?? false },
        });
        return created.id;
      });
      records.push(result);
      if (localId) columnMap.set(col.sourceId, localId);
    }

    const cardTypeMap = new Map<string, string>();
    for await (const ct of ctx.importer.fetchCardTypes(projectRec.sourceId)) {
      const { localId, result } = await createOrSkip(ctx, "cardType", ct.sourceId, async () => {
        const created = await db.cardType.create({
          data: { projectId: projectLocalId, name: ct.name, icon: ct.icon || "Tag", color: ct.color || "#6366f1" },
        });
        return created.id;
      });
      records.push(result);
      if (localId) cardTypeMap.set(ct.sourceId, localId);
    }

    const labelMap = new Map<string, string>();
    for await (const lbl of ctx.importer.fetchLabels(projectRec.sourceId)) {
      const { localId, result } = await createOrSkip(ctx, "label", lbl.sourceId, async () => {
        const created = await db.label.create({
          data: { projectId: projectLocalId, name: lbl.name, color: lbl.color || "#3b82f6" },
        });
        return created.id;
      });
      records.push(result);
      if (localId) labelMap.set(lbl.sourceId, localId);
    }

    const maxCard = await db.card.findFirst({
      where: { projectId: projectLocalId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    let nextNumber = maxCard ? maxCard.number + 1 : 1;
    const columnMaxOrder = new Map<string, number>();

    for await (const card of ctx.importer.fetchCards(projectRec.sourceId)) {
      const columnLocalId = columnMap.get(card.columnSourceId);
      if (!columnLocalId) {
        records.push({
          entityType: "card",
          sourceId: card.sourceId,
          status: "failed",
          error: `Unknown columnSourceId "${card.columnSourceId}" — no matching column was imported for this project`,
        });
        continue;
      }

      const { localId: cardLocalId, result: cardResult } = await createOrSkip(ctx, "card", card.sourceId, async () => {
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
        const number = nextNumber++;

        const created = await db.card.create({
          data: {
            projectId: projectLocalId,
            columnId: columnLocalId,
            title: card.title,
            description: card.description,
            number,
            order,
            priority: card.priority || "NONE",
            points: card.points ?? null,
            owner: card.owner ?? null,
            dueDate: card.dueDate ? new Date(card.dueDate) : null,
            completedAt: card.completedAt ? new Date(card.completedAt) : null,
            typeId: card.typeSourceId ? cardTypeMap.get(card.typeSourceId) ?? null : null,
            labels:
              card.labelSourceIds && card.labelSourceIds.length > 0
                ? {
                    create: card.labelSourceIds
                      .map((sid) => labelMap.get(sid))
                      .filter((id): id is string => !!id)
                      .map((labelId) => ({ labelId })),
                  }
                : undefined,
          },
        });
        return created.id;
      });
      records.push(cardResult);
      if (!cardLocalId) continue;

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
    }
  }
}

async function classifyForDryRun(
  importer: Importer,
  userId: string,
  source: string,
  records: ImportDryRunRecordResult[]
) {
  async function classify(entityType: ImportEntityType, sourceId: string) {
    const existing = await findExistingMapping(userId, source, entityType, sourceId);
    const alreadyImported = !!existing && (await rowStillExists(entityType, existing.localId));
    records.push({ entityType, sourceId, status: alreadyImported ? "would_skip" : "would_create" });
  }

  for await (const project of importer.fetchProjects()) {
    await classify("project", project.sourceId);
    for await (const col of importer.fetchColumns(project.sourceId)) await classify("column", col.sourceId);
    for await (const ct of importer.fetchCardTypes(project.sourceId)) await classify("cardType", ct.sourceId);
    for await (const lbl of importer.fetchLabels(project.sourceId)) await classify("label", lbl.sourceId);
    for await (const card of importer.fetchCards(project.sourceId)) {
      await classify("card", card.sourceId);
      for await (const comment of importer.fetchComments(card.sourceId)) {
        await classify("comment", comment.sourceId);
      }
    }
  }
}

export async function runImport(
  importer: Importer,
  userId: string,
  options: RunImportOptions = {}
): Promise<ImportSummary | ImportDryRunSummary> {
  const importRunId = randomUUID();

  if (options.dryRun) {
    const records: ImportDryRunRecordResult[] = [];
    await classifyForDryRun(importer, userId, importer.name, records);
    const wouldCreate = records.filter((r) => r.status === "would_create").length;
    const wouldSkip = records.filter((r) => r.status === "would_skip").length;
    return { mode: "dry-run", importRunId, totals: { wouldCreate, wouldSkip }, records };
  }

  const records: ImportRecordResult[] = [];
  await importProject({ importer, userId, source: importer.name, importRunId }, records);

  const created = records.filter((r) => r.status === "created").length;
  const skipped = records.filter((r) => r.status === "skipped").length;
  const failed = records.filter((r) => r.status === "failed").length;
  return { mode: "live", importRunId, totals: { created, skipped, failed }, records };
}
