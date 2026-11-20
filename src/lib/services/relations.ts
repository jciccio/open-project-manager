import { isClosedColumn } from "@/lib/columnGroups";
import { normalizeRelation } from "@/lib/cardRelations";
import { db } from "@/lib/db";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import { safeRevalidatePath } from "@/lib/revalidate";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function addCardRelation(
  sourceCardId: string,
  targetCardId: string,
  type: string = "BLOCKS",
  userId: string
) {
  try {
    const canonical = normalizeRelation(sourceCardId, targetCardId, type);
    if (!canonical.valid) {
      return { success: false, error: canonical.error, kind: "invalid" as ServiceErrorKind };
    }

    const sourceCard = await db.card.findUnique({ where: { id: sourceCardId } });
    const targetCard = await db.card.findUnique({ where: { id: targetCardId } });

    if (!sourceCard || !targetCard) {
      return { success: false, error: "Unauthorized or card not found", kind: "not_found" as ServiceErrorKind };
    }
    const sourceDenied = await accessDenial(sourceCard.projectId, userId, "MEMBER");
    if (sourceDenied) {
      return { success: false, error: "Unauthorized or card not found", kind: sourceDenied as ServiceErrorKind };
    }
    if (!(await verifyProjectAccess(targetCard.projectId, userId, "VIEWER"))) {
      return { success: false, error: "Unauthorized or card not found", kind: "not_found" as ServiceErrorKind };
    }

    const triple = { sourceCardId: canonical.sourceId, targetCardId: canonical.targetId, type: canonical.type };
    const relation = await db.cardRelation.upsert({
      where: { sourceCardId_targetCardId_type: triple },
      create: triple,
      update: {},
      include: {
        sourceCard: { include: { project: true } },
        targetCard: { include: { project: true } },
      },
    });

    safeRevalidatePath(`/projects/${sourceCard.projectId}`);
    if (targetCard.projectId !== sourceCard.projectId) safeRevalidatePath(`/projects/${targetCard.projectId}`);
    return { success: true, data: relation };
  } catch (error) {
    console.error("Error creating card relation:", error);
    return { success: false, error: "Failed to create card relation", kind: "internal" as ServiceErrorKind };
  }
}

export async function removeCardRelation(relationId: string, userId: string) {
  try {
    const relation = await db.cardRelation.findUnique({
      where: { id: relationId },
      include: {
        sourceCard: { select: { projectId: true } },
        targetCard: { select: { projectId: true } },
      },
    });

    if (!relation) {
      return { success: false, error: "Unauthorized or relation not found", kind: "not_found" as ServiceErrorKind };
    }
    const sourceDenied = await accessDenial(relation.sourceCard.projectId, userId, "MEMBER");
    const targetDenied = sourceDenied && (await accessDenial(relation.targetCard.projectId, userId, "MEMBER"));
    if (sourceDenied && targetDenied) {
      const kind = sourceDenied === "forbidden" || targetDenied === "forbidden" ? "forbidden" : "not_found";
      return { success: false, error: "Unauthorized or relation not found", kind: kind as ServiceErrorKind };
    }

    await db.cardRelation.delete({ where: { id: relationId } });
    safeRevalidatePath(`/projects/${relation.sourceCard.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card relation ${relationId}:`, error);
    return { success: false, error: "Failed to delete card relation", kind: "internal" as ServiceErrorKind };
  }
}

export async function viewableProjectIds(projectIds: Iterable<string>, userId: string): Promise<Set<string>> {
  const distinct = [...new Set(projectIds)];
  const allowed = await Promise.all(distinct.map((id) => verifyProjectAccess(id, userId, "VIEWER")));
  return new Set(distinct.filter((_, i) => allowed[i]));
}

export async function getCardRelations(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({ where: { id: cardId } });

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "VIEWER"))) {
      return { success: false, error: "Unauthorized or card not found", kind: "not_found" as ServiceErrorKind };
    }

    const allOutgoing = await db.cardRelation.findMany({
      where: { sourceCardId: cardId },
      include: {
        targetCard: {
          include: { project: true, column: true },
        },
      },
    });

    const allIncoming = await db.cardRelation.findMany({
      where: { targetCardId: cardId },
      include: {
        sourceCard: {
          include: { project: true, column: true },
        },
      },
    });

    const viewable = await viewableProjectIds(
      [...allOutgoing.map((r) => r.targetCard.projectId), ...allIncoming.map((r) => r.sourceCard.projectId)],
      userId
    );
    const outgoing = allOutgoing.filter((r) => viewable.has(r.targetCard.projectId));
    const incoming = allIncoming.filter((r) => viewable.has(r.sourceCard.projectId));

    const formattedOutgoing = outgoing.map((r) => ({
      id: r.id,
      relationType: r.type,
      cardId: r.targetCardId,
      cardTitle: r.targetCard.title,
      identifier: `${r.targetCard.project.key}-${r.targetCard.number}`,
      columnName: r.targetCard.column.name,
      isDone: r.targetCard.column.isDone,
      isClosed: isClosedColumn(r.targetCard.column),
      direction: "outgoing" as const,
    }));

    const formattedIncoming = incoming.map((r) => {
      let invertedType = r.type;
      if (r.type === "BLOCKS") invertedType = "BLOCKED_BY";
      else if (r.type === "BLOCKED_BY") invertedType = "BLOCKS";

      return {
        id: r.id,
        relationType: invertedType,
        cardId: r.sourceCardId,
        cardTitle: r.sourceCard.title,
        identifier: `${r.sourceCard.project.key}-${r.sourceCard.number}`,
        columnName: r.sourceCard.column.name,
        isDone: r.sourceCard.column.isDone,
        isClosed: isClosedColumn(r.sourceCard.column),
        direction: "incoming" as const,
      };
    });

    return {
      success: true,
      data: [...formattedOutgoing, ...formattedIncoming],
    };
  } catch (error) {
    console.error(`Error fetching relations for card ${cardId}:`, error);
    return { success: false, error: "Failed to fetch card relations", kind: "internal" as ServiceErrorKind };
  }
}
