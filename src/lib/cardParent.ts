import { db } from "@/lib/db";

export async function validateParentCard(
  projectId: string,
  parentId: string,
  cardId?: string
): Promise<string | null> {
  if (cardId) {
    if (parentId === cardId) {
      return "A card cannot be its own parent";
    }
    const childCount = await db.card.count({ where: { parentId: cardId } });
    if (childCount > 0) {
      return "A card with subtasks cannot be made a subtask";
    }
  }

  const parent = await db.card.findUnique({
    where: { id: parentId },
    select: { projectId: true, parentId: true },
  });
  if (!parent || parent.projectId !== projectId) {
    return "Parent card not found in this project";
  }
  if (parent.parentId) {
    return "Subtasks cannot be nested under another subtask";
  }
  return null;
}
