"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function verifyProjectOwnership(projectId: string, userId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
  });
  return !!project;
}

export async function createCard(
  data: {
    projectId: string;
    columnId: string;
    title: string;
    description?: string;
    priority?: string;
    points?: number | null;
    owner?: string | null;
    dueDate?: string | null;
    labelIds?: string[];
  },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session || !(await verifyProjectOwnership(data.projectId, session.userId))) {
      return { success: false, error: "Unauthorized" };
    }

    if (!data.title.trim()) {
      return { success: false, error: "Card title is required" };
    }

    const lastCard = await db.card.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastCard ? lastCard.order + 1 : 0;

    const maxCard = await db.card.findFirst({
      where: { projectId: data.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNumber = maxCard ? maxCard.number + 1 : 1;

    const card = await db.card.create({
      data: {
        projectId: data.projectId,
        columnId: data.columnId,
        title: data.title.trim(),
        description: data.description,
        number: nextNumber,
        priority: data.priority || "MEDIUM",
        points: data.points ?? null,
        owner: data.owner || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        order: newOrder,
        labels:
          data.labelIds && data.labelIds.length > 0
            ? {
                create: data.labelIds.map((labelId) => ({ labelId })),
              }
            : undefined,
      },
      include: {
        labels: {
          include: { label: true },
        },
        comments: true,
      },
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error("Error creating card:", error);
    return { success: false, error: "Failed to create card" };
  }
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
    labelIds?: string[];
  },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existingCard = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!existingCard || existingCard.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    const updatePayload: any = {
      title: data.title !== undefined ? data.title : undefined,
      description: data.description !== undefined ? data.description : undefined,
      priority: data.priority !== undefined ? data.priority : undefined,
      points: data.points !== undefined ? data.points : undefined,
      owner: data.owner !== undefined ? data.owner : undefined,
      dueDate: data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
      order: data.order !== undefined ? data.order : undefined,
      columnId: data.columnId !== undefined ? data.columnId : undefined,
    };

    if (data.labelIds !== undefined) {
      await db.cardLabel.deleteMany({ where: { cardId: id } });
      if (data.labelIds.length > 0) {
        updatePayload.labels = {
          create: data.labelIds.map((labelId) => ({ labelId })),
        };
      }
    }

    const card = await db.card.update({
      where: { id },
      data: updatePayload,
      include: {
        labels: {
          include: { label: true },
        },
        comments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    revalidatePath(`/projects/${existingCard.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error updating card ${id}:`, error);
    return { success: false, error: "Failed to update card" };
  }
}

export async function moveCard(
  cardId: string,
  targetColumnId: string,
  newOrder: number,
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existingCard = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!existingCard || existingCard.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    const card = await db.card.update({
      where: { id: cardId },
      data: {
        columnId: targetColumnId,
        order: newOrder,
      },
    });

    revalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error moving card ${cardId}:`, error);
    return { success: false, error: "Failed to move card" };
  }
}

export async function deleteCard(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existingCard = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!existingCard || existingCard.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    await db.card.delete({
      where: { id },
    });

    revalidatePath(`/projects/${existingCard.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card ${id}:`, error);
    return { success: false, error: "Failed to delete card" };
  }
}

export async function getCardByIdentifier(identifier: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const clean = identifier.trim();
    const lastDash = clean.lastIndexOf("-");
    if (lastDash === -1) {
      return { success: false, error: "Invalid identifier format. Expected KEY-NUMBER (e.g. OPM-42)" };
    }

    const key = clean.slice(0, lastDash).toUpperCase();
    const num = parseInt(clean.slice(lastDash + 1), 10);

    if (isNaN(num)) {
      return { success: false, error: "Invalid card number in identifier" };
    }

    const card = await db.card.findFirst({
      where: {
        number: num,
        project: {
          key,
          userId: session.userId,
        },
      },
      include: {
        project: true,
        column: true,
        labels: {
          include: { label: true },
        },
        comments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!card) {
      return { success: false, error: `Card '${identifier}' not found` };
    }

    return {
      success: true,
      data: {
        ...card,
        identifier: `${card.project.key}-${card.number}`,
      },
    };
  } catch (error) {
    console.error(`Error looking up card by identifier '${identifier}':`, error);
    return { success: false, error: "Failed to fetch card by identifier" };
  }
}

