import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { recordActivity } from "@/actions/activity";
import { nextCardNumber, withCardNumberRetry } from "@/lib/cardNumbering";
import { verifyProjectAccess } from "@/lib/permissions";

// Server actions never sends an id to Prisma without checking it resolves to a row
// within the same project (or, for assignees, the same user) — a foreign id here
// would attach another project's data to this card, or leak another user's name/email.
async function validateReferencedIds(
  projectId: string,
  userId: string,
  refs: {
    columnId?: string;
    parentId?: string | null;
    typeId?: string | null;
    labelIds?: string[];
    assigneeIds?: string[];
  }
): Promise<string | null> {
  if (refs.columnId !== undefined) {
    const column = await db.column.findUnique({ where: { id: refs.columnId }, select: { projectId: true } });
    if (!column || column.projectId !== projectId) {
      return "Invalid column";
    }
  }

  if (refs.parentId) {
    const parent = await db.card.findUnique({
      where: { id: refs.parentId },
      select: { projectId: true, parentId: true },
    });
    if (!parent || parent.projectId !== projectId) {
      return "Invalid parent card";
    }
    if (parent.parentId) {
      return "Subtasks cannot be nested under another subtask";
    }
  }

  if (refs.typeId) {
    const type = await db.cardType.findUnique({ where: { id: refs.typeId }, select: { projectId: true } });
    if (!type || type.projectId !== projectId) {
      return "Invalid card type";
    }
  }

  if (refs.labelIds && refs.labelIds.length > 0) {
    const uniqueLabelIds = new Set(refs.labelIds);
    const count = await db.label.count({
      where: {
        id: { in: refs.labelIds },
        OR: [{ projectId }, { userId, projectId: null }, { userId: null, projectId: null }],
      },
    });
    if (count !== uniqueLabelIds.size) {
      return "Invalid label";
    }
  }

  if (refs.assigneeIds && refs.assigneeIds.some((assigneeId) => assigneeId !== userId)) {
    return "Cards can only be assigned to yourself";
  }

  return null;
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
    if (!(await verifyProjectAccess(data.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized" };
    }

    if (!data.title.trim()) {
      return { success: false, error: "Card title is required" };
    }

    const referenceError = await validateReferencedIds(data.projectId, userId, {
      columnId: data.columnId,
      parentId: data.parentId,
      typeId: data.typeId,
      labelIds: data.labelIds,
      assigneeIds: data.assigneeIds,
    });
    if (referenceError) {
      return { success: false, error: referenceError };
    }

    const ORDER_GAP = 10000;
    const lastCard = await db.card.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastCard ? lastCard.order + ORDER_GAP : ORDER_GAP;

    const targetColumn = await db.column.findUnique({ where: { id: data.columnId } });
    const completedAt = targetColumn?.isDone ? new Date() : null;

    const firstAttemptNumber = await nextCardNumber(data.projectId);
    const card = await withCardNumberRetry(data.projectId, firstAttemptNumber, (number) =>
      db.card.create({
        data: {
          projectId: data.projectId,
          columnId: data.columnId,
          title: data.title.trim(),
          description: data.description,
          number,
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
      })
    );

    await recordActivity({
      cardId: card.id,
      projectId: data.projectId,
      actorUserId: userId,
      type: "card_created",
      toValue: card.title,
    });

    safeRevalidatePath(`/projects/${data.projectId}`);
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
  },
  userId: string
) {
  try {
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

    if (!existingCard || !(await verifyProjectAccess(existingCard.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized" };
    }

    if (data.parentId !== undefined && data.parentId !== null && data.parentId !== "") {
      if (data.parentId === id) {
        return { success: false, error: "A card cannot be its own parent" };
      }

      const childCount = await db.card.count({ where: { parentId: id } });
      if (childCount > 0) {
        return { success: false, error: "A card with subtasks cannot be made a subtask" };
      }
    }

    const referenceError = await validateReferencedIds(existingCard.projectId, userId, {
      columnId: data.columnId,
      parentId: data.parentId,
      typeId: data.typeId,
      labelIds: data.labelIds,
      assigneeIds: data.assigneeIds,
    });
    if (referenceError) {
      return { success: false, error: referenceError };
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

    if (data.labelIds !== undefined && data.labelIds.length > 0) {
      updatePayload.labels = {
        create: data.labelIds.map((labelId) => ({ labelId })),
      };
    }

    if (data.assigneeIds !== undefined && data.assigneeIds.length > 0) {
      updatePayload.assignees = {
        create: data.assigneeIds.map((assigneeId) => ({ userId: assigneeId })),
      };
    }

    const updateCardQuery = db.card.update({
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

    // deleteMany + update run in one transaction so a failure partway through
    // never leaves the card with its labels/assignees wiped but not replaced.
    const transactionOps = [
      ...(data.labelIds !== undefined ? [db.cardLabel.deleteMany({ where: { cardId: id } })] : []),
      ...(data.assigneeIds !== undefined ? [db.cardAssignee.deleteMany({ where: { cardId: id } })] : []),
      updateCardQuery,
    ] as [typeof updateCardQuery];
    const results = await db.$transaction(transactionOps);
    const card = results[results.length - 1];

    // Record activity events
    if (data.title !== undefined && data.title !== existingCard.title) {
      await recordActivity({
        cardId: id,
        projectId: existingCard.projectId,
        actorUserId: userId,
        type: "title_changed",
        fromValue: existingCard.title,
        toValue: data.title,
      });
    }

    if (data.description !== undefined && data.description !== existingCard.description) {
      await recordActivity({
        cardId: id,
        projectId: existingCard.projectId,
        actorUserId: userId,
        type: "description_changed",
        fromValue: existingCard.description || undefined,
        toValue: data.description || undefined,
      });
    }

    if (data.priority !== undefined && data.priority !== existingCard.priority) {
      await recordActivity({
        cardId: id,
        projectId: existingCard.projectId,
        actorUserId: userId,
        type: "priority_changed",
        fromValue: existingCard.priority,
        toValue: data.priority,
      });
    }

    if (data.points !== undefined && data.points !== existingCard.points) {
      await recordActivity({
        cardId: id,
        projectId: existingCard.projectId,
        actorUserId: userId,
        type: "points_changed",
        fromValue: existingCard.points != null ? String(existingCard.points) : undefined,
        toValue: data.points != null ? String(data.points) : undefined,
      });
    }

    if (data.columnId !== undefined && data.columnId !== existingCard.columnId) {
      await recordActivity({
        cardId: id,
        projectId: existingCard.projectId,
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
        projectId: existingCard.projectId,
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
          projectId: existingCard.projectId,
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
            projectId: existingCard.projectId,
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
            projectId: existingCard.projectId,
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
            projectId: existingCard.projectId,
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
            projectId: existingCard.projectId,
            actorUserId: userId,
            type: "unassigned",
            fromValue: u?.name || old.userId,
          });
        }
      }
    }

    safeRevalidatePath(`/projects/${existingCard.projectId}`);
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

    if (!existingCard || !(await verifyProjectAccess(existingCard.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized" };
    }

    const targetColumn = await db.column.findUnique({ where: { id: targetColumnId } });
    if (!targetColumn || targetColumn.projectId !== existingCard.projectId) {
      return { success: false, error: "Invalid column" };
    }
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
        projectId: existingCard.projectId,
        actorUserId: userId,
        type: "moved",
        fromValue: existingCard.column?.name,
        toValue: targetColumn?.name,
      });
    }

    safeRevalidatePath(`/projects/${card.projectId}`);
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

    if (!existingCard || !(await verifyProjectAccess(existingCard.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized" };
    }

    await db.card.delete({
      where: { id },
    });

    safeRevalidatePath(`/projects/${existingCard.projectId}`);
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

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "VIEWER"))) {
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

export async function addCardLink(cardId: string, url: string, title: string | undefined, userId: string) {
  try {
    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized" };
    }

    const link = await db.cardLink.create({
      data: {
        cardId,
        url,
        title,
      },
    });

    safeRevalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: link };
  } catch (error) {
    console.error("Error adding card link:", error);
    return { success: false, error: "Failed to add card link" };
  }
}

export interface ReorderItem {
  id: string;
  order: number;
  columnId?: string;
}

export async function reorderCards(items: ReorderItem[], userId: string) {
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: "Items array is required" };
    }

    const cardIds = items.map((i) => i.id);
    const existingCards = await db.card.findMany({
      where: {
        id: { in: cardIds },
      },
      select: { id: true, projectId: true },
    });

    if (existingCards.length !== cardIds.length) {
      return { success: false, error: "Unauthorized or card not found" };
    }

    for (const card of existingCards) {
      const canEdit = await verifyProjectAccess(card.projectId, userId, "MEMBER");
      if (!canEdit) {
        return { success: false, error: "Unauthorized or card not found" };
      }
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
    const projectIds = new Set(existingCards.map((c) => c.projectId));
    for (const projectId of projectIds) {
      safeRevalidatePath(`/projects/${projectId}`);
    }
    return { success: true };
  } catch (error) {
    console.error("Error reordering cards:", error);
    return { success: false, error: "Failed to reorder cards" };
  }
}

export async function removeCardLink(linkId: string, userId: string) {
  try {
    const link = await db.cardLink.findUnique({
      where: { id: linkId },
      include: { card: { include: { project: true } } },
    });

    if (!link || !(await verifyProjectAccess(link.card.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Unauthorized or link not found" };
    }

    await db.cardLink.delete({ where: { id: linkId } });
    safeRevalidatePath(`/projects/${link.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Error removing card link:", error);
    return { success: false, error: "Failed to remove card link" };
  }
}
