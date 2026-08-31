import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function addCardRelation(
  sourceCardId: string,
  targetCardId: string,
  type: string = "BLOCKS",
  userId: string
) {
  try {
    if (sourceCardId === targetCardId) {
      return { success: false, error: "A card cannot relate to itself" };
    }

    const validTypes = ["BLOCKS", "BLOCKED_BY", "RELATES_TO"];
    const normalizedType = type.toUpperCase().trim();
    if (!validTypes.includes(normalizedType)) {
      return { success: false, error: `Invalid relation type '${type}'. Expected BLOCKS, BLOCKED_BY, or RELATES_TO` };
    }

    const sourceCard = await db.card.findUnique({
      where: { id: sourceCardId },
      include: { project: true },
    });
    const targetCard = await db.card.findUnique({ where: { id: targetCardId } });

    if (!sourceCard || !targetCard || sourceCard.project.userId !== userId) {
      return { success: false, error: "Unauthorized or card not found" };
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

    revalidatePath(`/projects/${sourceCard.projectId}`);
    return { success: true, data: relation };
  } catch (error) {
    console.error("Error creating card relation:", error);
    return { success: false, error: "Failed to create card relation" };
  }
}

export async function removeCardRelation(relationId: string, userId: string) {
  try {
    const relation = await db.cardRelation.findUnique({
      where: { id: relationId },
      include: { sourceCard: { include: { project: true } } },
    });

    if (!relation || relation.sourceCard.project.userId !== userId) {
      return { success: false, error: "Unauthorized or relation not found" };
    }

    await db.cardRelation.delete({ where: { id: relationId } });
    revalidatePath(`/projects/${relation.sourceCard.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card relation ${relationId}:`, error);
    return { success: false, error: "Failed to delete card relation" };
  }
}

export async function getCardRelations(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== userId) {
      return { success: false, error: "Unauthorized or card not found" };
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
        direction: "incoming" as const,
      };
    });

    return {
      success: true,
      data: [...formattedOutgoing, ...formattedIncoming],
    };
  } catch (error) {
    console.error(`Error fetching relations for card ${cardId}:`, error);
    return { success: false, error: "Failed to fetch card relations" };
  }
}
