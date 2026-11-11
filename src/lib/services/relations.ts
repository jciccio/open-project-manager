import { isClosedColumn } from "@/lib/columnGroups";
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
    if (sourceCardId === targetCardId) {
      return { success: false, error: "A card cannot relate to itself", kind: "invalid" as ServiceErrorKind };
    }

    const validTypes = ["BLOCKS", "BLOCKED_BY", "RELATES_TO"];
    const normalizedType = type.toUpperCase().trim();
    if (!validTypes.includes(normalizedType)) {
      return { success: false, error: `Invalid relation type '${type}'. Expected BLOCKS, BLOCKED_BY, or RELATES_TO`, kind: "invalid" as ServiceErrorKind };
    }

    const sourceCard = await db.card.findUnique({
      where: { id: sourceCardId },
      include: { project: true },
    });
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

    const relation = await db.cardRelation.create({
      data: {
        sourceCardId,
        targetCardId,
        type: normalizedType,
      },
      include: {
        sourceCard: { include: { project: true } },
        targetCard: { include: { project: true } },
      },
    });

    safeRevalidatePath(`/projects/${sourceCard.projectId}`);
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

export async function getCardRelations(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({ where: { id: cardId } });

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "VIEWER"))) {
      return { success: false, error: "Unauthorized or card not found", kind: "not_found" as ServiceErrorKind };
    }

    const outgoing = await db.cardRelation.findMany({
      where: { sourceCardId: cardId },
      include: {
        targetCard: {
          include: { project: true, column: true },
        },
      },
    });

    const incoming = await db.cardRelation.findMany({
      where: { targetCardId: cardId },
      include: {
        sourceCard: {
          include: { project: true, column: true },
        },
      },
    });

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
