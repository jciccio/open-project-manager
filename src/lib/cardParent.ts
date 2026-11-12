import { db } from "@/lib/db";

export interface CardParentReader {
  childCount(cardId: string): Promise<number>;
  card(cardId: string): Promise<{ projectId: string; parentId: string | null } | null>;
}

const databaseReader: CardParentReader = {
  childCount: (cardId) => db.card.count({ where: { parentId: cardId } }),
  card: (cardId) => db.card.findUnique({ where: { id: cardId }, select: { projectId: true, parentId: true } }),
};

export async function validateParentCard(
  projectId: string,
  parentId: string,
  cardId?: string,
  reader: CardParentReader = databaseReader
): Promise<string | null> {
  if (cardId) {
    if (parentId === cardId) {
      return "A card cannot be its own parent";
    }
    const childCount = await reader.childCount(cardId);
    if (childCount > 0) {
      return "A card with subtasks cannot be made a subtask";
    }
  }

  const parent = await reader.card(parentId);
  if (!parent || parent.projectId !== projectId) {
    return "Parent card not found in this project";
  }
  if (parent.parentId) {
    return "Subtasks cannot be nested under another subtask";
  }
  return null;
}
