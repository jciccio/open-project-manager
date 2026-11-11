"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import * as cardsService from "@/lib/services/cards";
import type { ServiceErrorKind } from "@/lib/services/result";

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
    return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
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
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.updateCard(id, data, session.userId);
}

export async function moveCard(cardId: string, targetColumnId: string, newOrder: number) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.moveCard(cardId, targetColumnId, newOrder, session.userId);
}

export async function deleteCard(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.deleteCard(id, session.userId);
}

export async function getCardByIdentifier(identifier: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.getCardByIdentifier(identifier, session.userId);
}

export async function archiveCard(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.archiveCard(id, session.userId);
}

export async function unarchiveCard(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.unarchiveCard(id, session.userId);
}

export async function getArchivedCards() {
  try {
    const session = await getSession();
    if (!session) {
      return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
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
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.reorderCards(items, session.userId);
}

export async function addCardLink(cardId: string, url: string, title?: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.addCardLink(cardId, url, title, session.userId);
}

export async function removeCardLink(linkId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return cardsService.removeCardLink(linkId, session.userId);
}
