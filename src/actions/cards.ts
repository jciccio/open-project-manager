"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { recordActivity } from "./activity";
import * as cardsService from "@/lib/services/cards";

export async function createCard(data: {
  projectId: string;
  columnId: string;
  title: string;
  description?: string;
  priority?: string;
  points?: number | null;
  owner?: string | null;
  dueDate?: string | null;
  parentId?: string | null;
  typeId?: string | null;
  labelIds?: string[];
  assigneeIds?: string[];
}) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return cardsService.createCard(data, session.userId);
}

export async function updateCard(
  id: string,
  data: {
    columnId?: string;
    title?: string;
    description?: string;
    priority?: string;
    points?: number | null;
    owner?: string | null;
    dueDate?: string | null;
    order?: number;
    parentId?: string | null;
    typeId?: string | null;
    labelIds?: string[];
    assigneeIds?: string[];
  }
) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.updateCard(id, data, session.userId);
}

export async function moveCard(cardId: string, targetColumnId: string, newOrder: number) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.moveCard(cardId, targetColumnId, newOrder, session.userId);
}

export async function deleteCard(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.deleteCard(id, session.userId);
}

export async function getCardByIdentifier(identifier: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.getCardByIdentifier(identifier, session.userId);
}

export async function archiveCard(id: string) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const card = await db.card.findFirst({
      where: { id, project: { userId: session.userId } },
    });

    if (!card) {
      return { success: false, error: "Card not found or access denied" };
    }

    const updated = await db.card.update({
      where: { id },
      data: { isArchived: true },
    });

    await recordActivity({
      cardId: id,
      actorUserId: session.userId,
      type: "archived",
    });

    revalidatePath(`/projects/${card.projectId}`);
    revalidatePath("/archived");
    return { success: true, data: updated };
  } catch (error) {
    console.error(`Error archiving card ${id}:`, error);
    return { success: false, error: "Failed to archive card" };
  }
}

export async function unarchiveCard(id: string) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const card = await db.card.findFirst({
      where: { id, project: { userId: session.userId } },
    });

    if (!card) {
      return { success: false, error: "Card not found or access denied" };
    }

    const updated = await db.card.update({
      where: { id },
      data: { isArchived: false },
    });

    await recordActivity({
      cardId: id,
      actorUserId: session.userId,
      type: "unarchived",
    });

    revalidatePath(`/projects/${card.projectId}`);
    revalidatePath("/archived");
    return { success: true, data: updated };
  } catch (error) {
    console.error(`Error unarchiving card ${id}:`, error);
    return { success: false, error: "Failed to unarchive card" };
  }
}

export async function getArchivedCards() {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const cards = await db.card.findMany({
      where: {
        isArchived: true,
        project: { userId: session.userId },
      },
      include: {
        project: true,
        column: true,
        type: true,
        labels: { include: { label: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return { success: true, data: cards };
  } catch (error) {
    console.error("Error fetching archived cards:", error);
    return { success: false, error: "Failed to fetch archived cards" };
  }
}

export interface ReorderItem {
  id: string;
  order: number;
  columnId?: string;
}

export async function reorderCards(items: ReorderItem[]) {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: "Items array is required" };
    }

    const cardIds = items.map((i) => i.id);
    const existingCards = await db.card.findMany({
      where: {
        id: { in: cardIds },
        project: { userId: session.userId },
      },
      select: { id: true, projectId: true },
    });

    if (existingCards.length !== cardIds.length) {
      return { success: false, error: "Unauthorized or card not found" };
    }
    const projectIdByCardId = new Map(existingCards.map((c) => [c.id, c.projectId]));

    const columnIds = [...new Set(items.map((i) => i.columnId).filter((id): id is string => !!id))];
    const columns = await db.column.findMany({
      where: { id: { in: columnIds } },
      select: { id: true, projectId: true },
    });
    const projectIdByColumnId = new Map(columns.map((c) => [c.id, c.projectId]));

    for (const item of items) {
      if (item.columnId && projectIdByColumnId.get(item.columnId) !== projectIdByCardId.get(item.id)) {
        return { success: false, error: "Invalid column" };
      }
    }

    const updates = items.map((item) =>
      db.card.update({
        where: { id: item.id },
        data: {
          order: item.order,
          ...(item.columnId ? { columnId: item.columnId } : {}),
        },
      })
    );

    await db.$transaction(updates);
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Error reordering cards:", error);
    return { success: false, error: "Failed to reorder cards" };
  }
}

export async function addCardLink(cardId: string, url: string, title?: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    const link = await db.cardLink.create({
      data: {
        cardId,
        url,
        title,
      },
    });

    revalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: link };
  } catch (error) {
    console.error("Error adding card link:", error);
    return { success: false, error: "Failed to add card link" };
  }
}

export async function removeCardLink(linkId: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const link = await db.cardLink.findUnique({
      where: { id: linkId },
      include: { card: { include: { project: true } } },
    });

    if (!link || link.card.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized or link not found" };
    }

    await db.cardLink.delete({ where: { id: linkId } });
    revalidatePath(`/projects/${link.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Error removing card link:", error);
    return { success: false, error: "Failed to remove card link" };
  }
}
