import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { recordActivity } from "@/actions/activity";

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
    parentId?: string | null;
    typeId?: string | null;
    labelIds?: string[];
    assigneeIds?: string[];
  },
  userId: string
) {
  try {
    if (!(await verifyProjectOwnership(data.projectId, userId))) {
      return { success: false, error: "Unauthorized" };
    }

    if (!data.title.trim()) {
      return { success: false, error: "Card title is required" };
    }

    const ORDER_GAP = 10000;
    const lastCard = await db.card.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastCard ? lastCard.order + ORDER_GAP : ORDER_GAP;

    const maxCard = await db.card.findFirst({
      where: { projectId: data.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNumber = maxCard ? maxCard.number + 1 : 1;

    const targetColumn = await db.column.findUnique({ where: { id: data.columnId } });
    const completedAt = targetColumn?.isDone ? new Date() : null;

    const card = await db.card.create({
      data: {
        projectId: data.projectId,
        columnId: data.columnId,
        title: data.title.trim(),
        description: data.description,
        number: nextNumber,
        priority: data.priority || "NONE",
        points: data.points ?? null,
        owner: data.owner || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        completedAt,
        order: newOrder,
        parentId: data.parentId || null,
        typeId: data.typeId || null,
        labels:
          data.labelIds && data.labelIds.length > 0
            ? {
                create: data.labelIds.map((labelId) => ({ labelId })),
              }
            : undefined,
        assignees:
          data.assigneeIds && data.assigneeIds.length > 0
            ? {
                create: data.assigneeIds.map((assigneeId) => ({ userId: assigneeId })),
              }
            : undefined,
      },
      include: {
        type: true,
        labels: {
          include: { label: true },
        },
        comments: true,
        activities: {
          orderBy: { createdAt: "desc" },
        },
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        parent: { select: { id: true, number: true, title: true } },
        children: { select: { id: true, number: true, title: true, completedAt: true } },
        links: true,
      },
    });

    await recordActivity({
      cardId: card.id,
      actorUserId: userId,
      type: "card_created",
      toValue: card.title,
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
    parentId?: string | null;
    typeId?: string | null;
    labelIds?: string[];
    assigneeIds?: string[];
  },
  userId: string
) {
  try {
    if (data.parentId === id) {
      return { success: false, error: "A card cannot be its own parent" };
    }

    const existingCard = await db.card.findUnique({
      where: { id },
      include: {
        project: true,
        column: true,
        type: true,
        labels: { include: { label: true } },
        assignees: true,
      },
    });

    if (!existingCard || existingCard.project.userId !== userId) {
      return { success: false, error: "Unauthorized" };
    }

    let targetColumn = null;
    let completedAtUpdate: Date | null | undefined = undefined;
    if (data.columnId !== undefined && data.columnId !== existingCard.columnId) {
      targetColumn = await db.column.findUnique({ where: { id: data.columnId } });
      completedAtUpdate = targetColumn?.isDone ? (existingCard.completedAt || new Date()) : null;
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
      parentId: data.parentId !== undefined ? (data.parentId || null) : undefined,
      typeId: data.typeId !== undefined ? (data.typeId || null) : undefined,
      completedAt: completedAtUpdate,
    };

    if (data.labelIds !== undefined) {
      await db.cardLabel.deleteMany({ where: { cardId: id } });
      if (data.labelIds.length > 0) {
        updatePayload.labels = {
          create: data.labelIds.map((labelId) => ({ labelId })),
        };
      }
    }

    if (data.assigneeIds !== undefined) {
      await db.cardAssignee.deleteMany({ where: { cardId: id } });
      if (data.assigneeIds.length > 0) {
        updatePayload.assignees = {
          create: data.assigneeIds.map((assigneeId) => ({ userId: assigneeId })),
        };
      }
    }

    const card = await db.card.update({
      where: { id },
      data: updatePayload,
      include: {
        type: true,
        labels: {
          include: { label: true },
        },
        comments: {
          orderBy: { createdAt: "desc" },
        },
        activities: {
          orderBy: { createdAt: "desc" },
        },
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        parent: { select: { id: true, number: true, title: true } },
        children: { select: { id: true, number: true, title: true, completedAt: true } },
        links: true,
      },
    });

    // Record activity events
    if (data.title !== undefined && data.title !== existingCard.title) {
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "title_changed",
        fromValue: existingCard.title,
        toValue: data.title,
      });
    }

    if (data.description !== undefined && data.description !== existingCard.description) {
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "description_changed",
        fromValue: existingCard.description || undefined,
        toValue: data.description || undefined,
      });
    }

    if (data.priority !== undefined && data.priority !== existingCard.priority) {
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "priority_changed",
        fromValue: existingCard.priority,
        toValue: data.priority,
      });
    }

    if (data.points !== undefined && data.points !== existingCard.points) {
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "points_changed",
        fromValue: existingCard.points != null ? String(existingCard.points) : undefined,
        toValue: data.points != null ? String(data.points) : undefined,
      });
    }

    if (data.columnId !== undefined && data.columnId !== existingCard.columnId) {
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "moved",
        fromValue: existingCard.column?.name,
        toValue: targetColumn?.name,
      });
    }

    if (data.typeId !== undefined && data.typeId !== existingCard.typeId) {
      const newType = data.typeId ? await db.cardType.findUnique({ where: { id: data.typeId } }) : null;
      await recordActivity({
        cardId: id,
        actorUserId: userId,
        type: "type_changed",
        fromValue: existingCard.type?.name,
        toValue: newType?.name,
      });
    }

    if (data.dueDate !== undefined) {
      const oldDue = existingCard.dueDate ? new Date(existingCard.dueDate).toISOString().slice(0, 10) : "";
      const newDue = data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : "";
      if (oldDue !== newDue) {
        await recordActivity({
          cardId: id,
          actorUserId: userId,
          type: "due_date_changed",
          fromValue: oldDue || undefined,
          toValue: newDue || undefined,
        });
      }
    }

    if (data.labelIds !== undefined) {
      const oldLabelIds = new Set(existingCard.labels.map((l) => l.labelId));
      const newLabelIds = new Set(data.labelIds);
      for (const addedId of data.labelIds) {
        if (!oldLabelIds.has(addedId)) {
          const l = await db.label.findUnique({ where: { id: addedId } });
          await recordActivity({
            cardId: id,
            actorUserId: userId,
            type: "label_added",
            toValue: l?.name || addedId,
          });
        }
      }
      for (const old of existingCard.labels) {
        if (!newLabelIds.has(old.labelId)) {
          await recordActivity({
            cardId: id,
            actorUserId: userId,
            type: "label_removed",
            fromValue: old.label.name,
          });
        }
      }
    }

    if (data.assigneeIds !== undefined) {
      const oldAssigneeIds = new Set(existingCard.assignees.map((a) => a.userId));
      const newAssigneeIds = new Set(data.assigneeIds);
      for (const addedId of data.assigneeIds) {
        if (!oldAssigneeIds.has(addedId)) {
          const u = await db.user.findUnique({ where: { id: addedId } });
          await recordActivity({
            cardId: id,
            actorUserId: userId,
            type: "assigned",
            toValue: u?.name || addedId,
          });
        }
      }
      for (const old of existingCard.assignees) {
        if (!newAssigneeIds.has(old.userId)) {
          const u = await db.user.findUnique({ where: { id: old.userId } });
          await recordActivity({
            cardId: id,
            actorUserId: userId,
            type: "unassigned",
            fromValue: u?.name || old.userId,
          });
        }
      }
    }

    revalidatePath(`/projects/${existingCard.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error updating card ${id}:`, error);
    return { success: false, error: "Failed to update card" };
  }
}

export async function moveCard(cardId: string, targetColumnId: string, newOrder: number, userId: string) {
  try {
    const existingCard = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true, column: true },
    });

    if (!existingCard || existingCard.project.userId !== userId) {
      return { success: false, error: "Unauthorized" };
    }

    const targetColumn = await db.column.findUnique({ where: { id: targetColumnId } });
    const completedAt = targetColumn?.isDone ? (existingCard.completedAt || new Date()) : null;

    const card = await db.card.update({
      where: { id: cardId },
      data: {
        columnId: targetColumnId,
        order: newOrder,
        completedAt,
      },
    });

    if (existingCard.columnId !== targetColumnId) {
      await recordActivity({
        cardId,
        actorUserId: userId,
        type: "moved",
        fromValue: existingCard.column?.name,
        toValue: targetColumn?.name,
      });
    }

    revalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error moving card ${cardId}:`, error);
    return { success: false, error: "Failed to move card" };
  }
}

export async function deleteCard(id: string, userId: string) {
  try {
    const existingCard = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!existingCard || existingCard.project.userId !== userId) {
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

export async function getCardByIdentifier(identifier: string, userId: string) {
  try {
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
          userId,
        },
      },
      include: {
        project: true,
        column: true,
        type: true,
        labels: {
          include: { label: true },
        },
        comments: {
          orderBy: { createdAt: "desc" },
        },
        activities: {
          orderBy: { createdAt: "desc" },
        },
        assignees: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        parent: { select: { id: true, number: true, title: true } },
        children: { select: { id: true, number: true, title: true, completedAt: true } },
        links: true,
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
