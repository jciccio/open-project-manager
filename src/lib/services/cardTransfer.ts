import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { nextCardNumber, withCardNumberRetry } from "@/lib/cardNumbering";
import { accessDenial } from "@/lib/permissions";
import { deriveCompletedAt } from "@/lib/cardCompletion";
import type { ServiceErrorKind } from "@/lib/services/result";

export const PROJECT_CHANGED = "project_changed";

const ORDER_GAP = 10000;

const transferInclude = {
  project: { select: { key: true } },
  column: true,
  type: true,
  labels: { include: { label: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.CardInclude;

type TransferCard = Prisma.CardGetPayload<{ include: typeof transferInclude }>;

interface TargetColumn {
  id: string;
  name: string;
  group: string;
  isDone: boolean;
}

function pickColumn(source: TransferCard["column"], columns: TargetColumn[]): TargetColumn {
  const byName = columns.find((c) => c.name.trim().toLowerCase() === source.name.trim().toLowerCase());
  return byName ?? columns.find((c) => c.group === source.group) ?? columns[0];
}

function fail(error: string, kind: ServiceErrorKind) {
  return { success: false as const, error, kind: kind };
}

export async function moveCardToProject(
  cardId: string,
  targetProjectId: string,
  userId: string,
  options: { columnId?: string } = {}
) {
  try {
    const card = await db.card.findUnique({ where: { id: cardId }, include: transferInclude });
    if (!card) return fail("Card not found", "not_found");

    const sourceDenied = await accessDenial(card.projectId, userId, "MEMBER");
    if (sourceDenied) return fail("Card not found", sourceDenied);
    const targetDenied = await accessDenial(targetProjectId, userId, "MEMBER");
    if (targetDenied) return fail("Target project not found", targetDenied);

    if (card.projectId === targetProjectId) return fail("The card is already in this project", "invalid");
    if (card.parentId) return fail("A subtask moves with its parent card. Move the parent instead", "invalid");

    const target = await db.project.findUnique({
      where: { id: targetProjectId },
      select: {
        key: true,
        userId: true,
        members: { select: { userId: true } },
        columns: { orderBy: { order: "asc" }, select: { id: true, name: true, group: true, isDone: true } },
      },
    });
    if (!target) return fail("Target project not found", "not_found");
    if (target.columns.length === 0) return fail("The target project has no columns", "invalid");

    let explicitColumn: TargetColumn | undefined;
    if (options.columnId) {
      explicitColumn = target.columns.find((c) => c.id === options.columnId);
      if (!explicitColumn) return fail("Invalid column", "invalid");
    }

    const children = await db.card.findMany({
      where: { parentId: card.id },
      include: transferInclude,
      orderBy: { number: "asc" },
    });
    const moving = [card, ...children];
    const assignable = new Set([target.userId, ...target.members.map((m) => m.userId)]);
    const columnFor = (c: TransferCard) => (c.id === card.id && explicitColumn) || pickColumn(c.column, target.columns);

    const runTransfer = (firstNumber: number) =>
      db.$transaction(async (tx) => {
        const typeIds = new Map<string, string>();
        const labelIds = new Map<string, string>();
        const entries: ActivityEntry[] = [];
        const moved: { from: string; to: string }[] = [];

        for (const [index, item] of moving.entries()) {
          const number = firstNumber + index;
          const column = columnFor(item);
          const fromIdentifier = `${item.project.key}-${item.number}`;
          const toIdentifier = `${target.key}-${number}`;

          let typeId: string | null = null;
          if (item.type) {
            typeId = typeIds.get(item.type.name) ?? null;
            if (!typeId) {
              const existing = await tx.cardType.findUnique({
                where: { name_projectId: { name: item.type.name, projectId: targetProjectId } },
                select: { id: true },
              });
              typeId = (
                existing ??
                (await tx.cardType.create({
                  data: { projectId: targetProjectId, name: item.type.name, icon: item.type.icon, color: item.type.color },
                  select: { id: true },
                }))
              ).id;
              typeIds.set(item.type.name, typeId);
            }
          }

          const keptLabelIds: string[] = [];
          for (const { label } of item.labels) {
            if (label.projectId === null) {
              keptLabelIds.push(label.id);
              continue;
            }
            let mapped = labelIds.get(label.name);
            if (!mapped) {
              const existing = await tx.label.findFirst({
                where: { name: label.name, projectId: targetProjectId, userId: null },
                select: { id: true },
              });
              mapped = (
                existing ??
                (await tx.label.create({
                  data: {
                    projectId: targetProjectId,
                    userId: null,
                    name: label.name,
                    color: label.color,
                    description: label.description,
                  },
                  select: { id: true },
                }))
              ).id;
              labelIds.set(label.name, mapped);
            }
            keptLabelIds.push(mapped);
          }

          const dropped = item.assignees.filter((a) => !assignable.has(a.userId));

          const last = await tx.card.findFirst({
            where: { columnId: column.id },
            orderBy: { order: "desc" },
            select: { order: true },
          });

          await tx.cardLabel.deleteMany({ where: { cardId: item.id } });
          if (dropped.length > 0) {
            await tx.cardAssignee.deleteMany({
              where: { cardId: item.id, userId: { in: dropped.map((a) => a.userId) } },
            });
          }
          await tx.card.update({
            where: { id: item.id },
            data: {
              projectId: targetProjectId,
              columnId: column.id,
              number,
              order: (last?.order ?? 0) + ORDER_GAP,
              completedAt: deriveCompletedAt(column.isDone, item.completedAt),
              typeId,
              labels: { create: [...new Set(keptLabelIds)].map((labelId) => ({ labelId })) },
            },
          });

          entries.push({
            cardId: item.id,
            actorUserId: userId,
            type: PROJECT_CHANGED,
            fromValue: fromIdentifier,
            toValue: toIdentifier,
          });
          for (const a of dropped) {
            entries.push({
              cardId: item.id,
              actorUserId: userId,
              type: "unassigned",
              fromValue: a.user.name || a.user.email,
            });
          }
          moved.push({ from: fromIdentifier, to: toIdentifier });
        }

        await createActivities(tx, entries);
        return { entries, moved };
      });

    const { entries, moved } = await withCardNumberRetry(
      targetProjectId,
      await nextCardNumber(targetProjectId),
      runTransfer
    );

    notifyActivity(targetProjectId, entries);
    safeRevalidatePath(`/projects/${card.projectId}`);
    safeRevalidatePath(`/projects/${targetProjectId}`);

    const updated = await db.card.findUnique({ where: { id: card.id }, include: { project: { select: { key: true } } } });
    return {
      success: true as const,
      data: {
        card: updated ? { ...updated, identifier: `${updated.project.key}-${updated.number}` } : null,
        moved,
      },
    };
  } catch (error) {
    console.error(`Error moving card ${cardId} to project ${targetProjectId}:`, error);
    return fail("Failed to move card", "internal");
  }
}

export async function findMovedCardId(
  key: string,
  number: number,
  visibleProjects: Prisma.ProjectWhereInput
): Promise<string | null> {
  const record = await db.activity.findFirst({
    where: { type: PROJECT_CHANGED, fromValue: `${key}-${number}`, card: { project: visibleProjects } },
    orderBy: { createdAt: "desc" },
    select: { cardId: true },
  });
  return record?.cardId ?? null;
}
