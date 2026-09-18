"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeRevalidatePath } from "@/lib/revalidate";
import { recordActivity } from "./activity";
import * as cardsService from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";

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
    description?: string | null;
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

    const card = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!card || !(await verifyProjectAccess(card.projectId, session.userId, "MEMBER"))) {
      return { success: false, error: "Card not found or access denied" };
    }

    const updated = await db.card.update({
      where: { id },
      data: { isArchived: true },
    });

    await recordActivity({
      cardId: id,
      projectId: card.projectId,
      actorUserId: session.userId,
      type: "archived",
    });

    safeRevalidatePath(`/projects/${card.projectId}`);
    safeRevalidatePath("/archived");
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

    const card = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!card || !(await verifyProjectAccess(card.projectId, session.userId, "MEMBER"))) {
      return { success: false, error: "Card not found or access denied" };
    }

    const updated = await db.card.update({
      where: { id },
      data: { isArchived: false },
    });

    await recordActivity({
      cardId: id,
      projectId: card.projectId,
      actorUserId: session.userId,
      type: "unarchived",
    });

    safeRevalidatePath(`/projects/${card.projectId}`);
    safeRevalidatePath("/archived");
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
        project: {
          OR: [
            { userId: session.userId },
            { members: { some: { userId: session.userId } } },
          ],
        },
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

export type { ReorderItem } from "@/lib/services/cards";

export async function reorderCards(items: cardsService.ReorderItem[]) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.reorderCards(items, session.userId);
}

export async function addCardLink(cardId: string, url: string, title?: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.addCardLink(cardId, url, title, session.userId);
}

export async function removeCardLink(linkId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardsService.removeCardLink(linkId, session.userId);
}
