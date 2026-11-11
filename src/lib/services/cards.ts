import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { deleteRowsAndAttachmentFiles } from "@/lib/attachmentCleanup";
import { validateParentCard } from "@/lib/cardParent";
import { safeRevalidatePath } from "@/lib/revalidate";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { nextCardNumber, withCardNumberRetry } from "@/lib/cardNumbering";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import { deriveCompletedAt } from "@/lib/cardCompletion";
import { INVALID_LINK_URL_ERROR, SafeUrlSchema } from "@/lib/validation/safeUrl";
import { CardCreateSchema, CardReorderSchema, CardUpdateSchema } from "@/lib/validation/cards";
import { parseInput } from "@/lib/validation/errors";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function validateReferencedIds(
  projectId: string,
  userId: string,
  refs: {
    columnId?: string;
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

  if (refs.assigneeIds && refs.assigneeIds.length > 0) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { userId: true, members: { select: { userId: true } } },
    });
    const assignable = new Set([project?.userId, ...(project?.members.map((m) => m.userId) ?? [])]);
    if (refs.assigneeIds.some((assigneeId) => !assignable.has(assigneeId))) {
      return "Assignees must be members of this project";
    }
  }

  return null;
}

export async function createCard(
  rawData: {
    projectId: string;
    columnId: string;
    title: string;
    description?: string | null;
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
    const parsed = parseInput(CardCreateSchema, rawData);
    if (!parsed.success) return parsed;
    const data = parsed.data;

    const denied = await accessDenial(data.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    if (data.parentId) {
      const parentError = await validateParentCard(data.projectId, data.parentId);
      if (parentError) {
        return { success: false, error: parentError, kind: "invalid" as ServiceErrorKind };
      }
    }

    const referenceError = await validateReferencedIds(data.projectId, userId, {
      columnId: data.columnId,
      typeId: data.typeId,
      labelIds: data.labelIds,
      assigneeIds: data.assigneeIds,
    });
    if (referenceError) {
      return { success: false, error: referenceError, kind: "invalid" as ServiceErrorKind };
    }

    const ORDER_GAP = 10000;
    const lastCard = await db.card.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastCard ? lastCard.order + ORDER_GAP : ORDER_GAP;

    const targetColumn = await db.column.findUnique({ where: { id: data.columnId } });
    const completedAt = deriveCompletedAt(targetColumn?.isDone, null);

    const createdEntry = (created: { id: string; title: string }): ActivityEntry => ({
      cardId: created.id,
      actorUserId: userId,
      type: "card_created",
      toValue: created.title,
    });

    const firstAttemptNumber = await nextCardNumber(data.projectId);
    const card = await withCardNumberRetry(data.projectId, firstAttemptNumber, (number) =>
      db.$transaction(async (tx) => {
        const created = await tx.card.create({
          data: {
            projectId: data.projectId,
            columnId: data.columnId,
            title: data.title,
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
        });
        await createActivities(tx, [createdEntry(created)]);
        return created;
      })
    );

    notifyActivity(data.projectId, [createdEntry(card)]);

    safeRevalidatePath(`/projects/${data.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error("Error creating card:", error);
    return { success: false, error: "Failed to create card", kind: "internal" as ServiceErrorKind };
  }
}

export async function updateCard(
  id: string,
  rawData: {
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
    const parsed = parseInput(CardUpdateSchema, rawData);
    if (!parsed.success) return parsed;
    const data = parsed.data;

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

    if (!existingCard) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(existingCard.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    if (data.parentId) {
      const parentError = await validateParentCard(existingCard.projectId, data.parentId, id);
      if (parentError) {
        return { success: false, error: parentError, kind: "invalid" as ServiceErrorKind };
      }
    }

    const referenceError = await validateReferencedIds(existingCard.projectId, userId, {
      columnId: data.columnId,
      typeId: data.typeId,
      labelIds: data.labelIds,
      assigneeIds: data.assigneeIds,
    });
    if (referenceError) {
      return { success: false, error: referenceError, kind: "invalid" as ServiceErrorKind };
    }

    let targetColumn = null;
    let completedAtUpdate: Date | null | undefined = undefined;
    if (data.columnId !== undefined && data.columnId !== existingCard.columnId) {
      targetColumn = await db.column.findUnique({ where: { id: data.columnId } });
      completedAtUpdate = deriveCompletedAt(targetColumn?.isDone, existingCard.completedAt);
    }

    const updatePayload: Prisma.CardUncheckedUpdateInput = {
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
          include: {
            authorUser: {
              select: { id: true, name: true, email: true },
            },
          },
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

    const activityEntries: ActivityEntry[] = [];
    const logChange = (type: string, values: { fromValue?: string | null; toValue?: string | null }) =>
      activityEntries.push({ cardId: id, actorUserId: userId, type, ...values });

    if (data.title !== undefined && data.title !== existingCard.title) {
      logChange("title_changed", { fromValue: existingCard.title, toValue: data.title });
    }

    if (data.description !== undefined && data.description !== existingCard.description) {
      logChange("description_changed", {
        fromValue: existingCard.description || undefined,
        toValue: data.description || undefined,
      });
    }

    if (data.priority !== undefined && data.priority !== existingCard.priority) {
      logChange("priority_changed", { fromValue: existingCard.priority, toValue: data.priority });
    }

    if (data.points !== undefined && data.points !== existingCard.points) {
      logChange("points_changed", {
        fromValue: existingCard.points != null ? String(existingCard.points) : undefined,
        toValue: data.points != null ? String(data.points) : undefined,
      });
    }

    if (data.columnId !== undefined && data.columnId !== existingCard.columnId) {
      logChange("moved", { fromValue: existingCard.column?.name, toValue: targetColumn?.name });
    }

    if (data.typeId !== undefined && data.typeId !== existingCard.typeId) {
      const newType = data.typeId ? await db.cardType.findUnique({ where: { id: data.typeId } }) : null;
      logChange("type_changed", { fromValue: existingCard.type?.name, toValue: newType?.name });
    }

    if (data.dueDate !== undefined) {
      const oldDue = existingCard.dueDate ? new Date(existingCard.dueDate).toISOString().slice(0, 10) : "";
      const newDue = data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : "";
      if (oldDue !== newDue) {
        logChange("due_date_changed", { fromValue: oldDue || undefined, toValue: newDue || undefined });
      }
    }

    if (data.labelIds !== undefined) {
      const oldLabelIds = new Set(existingCard.labels.map((l) => l.labelId));
      const newLabelIds = new Set(data.labelIds);
      for (const addedId of data.labelIds) {
        if (!oldLabelIds.has(addedId)) {
          const l = await db.label.findUnique({ where: { id: addedId } });
          logChange("label_added", { toValue: l?.name || addedId });
        }
      }
      for (const old of existingCard.labels) {
        if (!newLabelIds.has(old.labelId)) {
          logChange("label_removed", { fromValue: old.label.name });
        }
      }
    }

    if (data.assigneeIds !== undefined) {
      const oldAssigneeIds = new Set(existingCard.assignees.map((a) => a.userId));
      const newAssigneeIds = new Set(data.assigneeIds);
      for (const addedId of data.assigneeIds) {
        if (!oldAssigneeIds.has(addedId)) {
          const u = await db.user.findUnique({ where: { id: addedId } });
          logChange("assigned", { toValue: u?.name || addedId });
        }
      }
      for (const old of existingCard.assignees) {
        if (!newAssigneeIds.has(old.userId)) {
          const u = await db.user.findUnique({ where: { id: old.userId } });
          logChange("unassigned", { fromValue: u?.name || old.userId });
        }
      }
    }

    // One transaction: the label/assignee rewrite, the card update and its
    // activity rows all commit or none do. The rows go first so the returned
    // card's `activities` include them.
    const transactionOps = [
      ...(data.labelIds !== undefined ? [db.cardLabel.deleteMany({ where: { cardId: id } })] : []),
      ...(data.assigneeIds !== undefined ? [db.cardAssignee.deleteMany({ where: { cardId: id } })] : []),
      ...(activityEntries.length > 0 ? [createActivities(db, activityEntries)] : []),
      updateCardQuery,
    ] as [typeof updateCardQuery];
    const results = await db.$transaction(transactionOps);
    const card = results[results.length - 1];

    notifyActivity(existingCard.projectId, activityEntries);

    safeRevalidatePath(`/projects/${existingCard.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error updating card ${id}:`, error);
    return { success: false, error: "Failed to update card", kind: "internal" as ServiceErrorKind };
  }
}

export async function moveCard(cardId: string, targetColumnId: string, newOrder: number, userId: string) {
  try {
    const existingCard = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true, column: true },
    });

    if (!existingCard) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(existingCard.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const targetColumn = await db.column.findUnique({ where: { id: targetColumnId } });
    if (!targetColumn || targetColumn.projectId !== existingCard.projectId) {
      return { success: false, error: "Invalid column", kind: "invalid" as ServiceErrorKind };
    }
    const completedAt = deriveCompletedAt(targetColumn.isDone, existingCard.completedAt);

    const activityEntries: ActivityEntry[] =
      existingCard.columnId !== targetColumnId
        ? [{ cardId, actorUserId: userId, type: "moved", fromValue: existingCard.column?.name, toValue: targetColumn.name }]
        : [];

    const card = await db.$transaction(async (tx) => {
      const moved = await tx.card.update({
        where: { id: cardId },
        data: {
          columnId: targetColumnId,
          order: newOrder,
          completedAt,
        },
      });
      await createActivities(tx, activityEntries);
      return moved;
    });

    notifyActivity(existingCard.projectId, activityEntries);

    safeRevalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: card };
  } catch (error) {
    console.error(`Error moving card ${cardId}:`, error);
    return { success: false, error: "Failed to move card", kind: "internal" as ServiceErrorKind };
  }
}

export async function deleteCard(id: string, userId: string) {
  try {
    const existingCard = await db.card.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!existingCard) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(existingCard.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    await deleteRowsAndAttachmentFiles({ cardId: id }, () =>
      db.card.delete({
        where: { id },
      })
    );

    safeRevalidatePath(`/projects/${existingCard.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card ${id}:`, error);
    return { success: false, error: "Failed to delete card", kind: "internal" as ServiceErrorKind };
  }
}

async function setCardArchived(id: string, isArchived: boolean, userId: string) {
  const card = await db.card.findUnique({ where: { id }, select: { projectId: true } });

  if (!card) {
    return { success: false, error: "Card not found or access denied", kind: "not_found" as ServiceErrorKind };
  }
  const denied = await accessDenial(card.projectId, userId, "MEMBER");
  if (denied) {
    return { success: false, error: "Card not found or access denied", kind: denied as ServiceErrorKind };
  }

  const activityEntries: ActivityEntry[] = [
    { cardId: id, actorUserId: userId, type: isArchived ? "archived" : "unarchived" },
  ];
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.card.update({
      where: { id },
      data: { isArchived },
    });
    await createActivities(tx, activityEntries);
    return result;
  });

  notifyActivity(card.projectId, activityEntries);

  safeRevalidatePath(`/projects/${card.projectId}`);
  safeRevalidatePath("/archived");
  return { success: true, data: updated };
}

export async function archiveCard(id: string, userId: string) {
  try {
    return await setCardArchived(id, true, userId);
  } catch (error) {
    console.error(`Error archiving card ${id}:`, error);
    return { success: false, error: "Failed to archive card", kind: "internal" as ServiceErrorKind };
  }
}

export async function unarchiveCard(id: string, userId: string) {
  try {
    return await setCardArchived(id, false, userId);
  } catch (error) {
    console.error(`Error unarchiving card ${id}:`, error);
    return { success: false, error: "Failed to unarchive card", kind: "internal" as ServiceErrorKind };
  }
}

export async function getCardByIdentifier(identifier: string, userId: string) {
  try {
    const clean = identifier.trim();
    const lastDash = clean.lastIndexOf("-");
    if (lastDash === -1) {
      return { success: false, error: "Invalid identifier format. Expected KEY-NUMBER (e.g. OPM-42)", kind: "invalid" as ServiceErrorKind };
    }

    const key = clean.slice(0, lastDash).toUpperCase();
    const num = parseInt(clean.slice(lastDash + 1), 10);

    if (isNaN(num)) {
      return { success: false, error: "Invalid card number in identifier", kind: "invalid" as ServiceErrorKind };
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
          include: {
            authorUser: {
              select: { id: true, name: true, email: true },
            },
          },
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
      return { success: false, error: `Card '${identifier}' not found`, kind: "not_found" as ServiceErrorKind };
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
    return { success: false, error: "Failed to fetch card by identifier", kind: "internal" as ServiceErrorKind };
  }
}

export async function getCardByProjectAndParam(projectId: string, param: string, userId: string) {
  try {
    if (!(await verifyProjectAccess(projectId, userId, "VIEWER"))) {
      return { success: false, error: "Access denied", kind: "forbidden" as ServiceErrorKind };
    }
    const clean = param.trim();
    if (!clean) {
      return { success: false, error: "Card identifier or ID is required", kind: "invalid" as ServiceErrorKind };
    }

    const include = {
      project: true,
      column: true,
      type: true,
      labels: { include: { label: true } },
      comments: {
        orderBy: { createdAt: "desc" as const },
        include: { authorUser: { select: { id: true, name: true, email: true } } },
      },
      activities: { orderBy: { createdAt: "desc" as const } },
      assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
      parent: { select: { id: true, number: true, title: true } },
      children: {
        where: { isArchived: false },
        orderBy: { order: "asc" as const },
        select: {
          id: true,
          number: true,
          title: true,
          dueDate: true,
          completedAt: true,
          columnId: true,
          column: {
            select: {
              id: true,
              name: true,
              isDone: true,
            },
          },
          assignees: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
      links: true,
    };

    // 1. Try exact ID
    let card = await db.card.findFirst({
      where: { id: clean, projectId },
      include,
    });

    // 2. Try KEY-NNN
    if (!card && clean.includes("-")) {
      const lastDash = clean.lastIndexOf("-");
      const key = clean.slice(0, lastDash).toUpperCase();
      const num = parseInt(clean.slice(lastDash + 1), 10);
      if (!isNaN(num)) {
        card = await db.card.findFirst({
          where: { number: num, project: { key }, projectId },
          include,
        });
      }
    }

    // 3. Try bare number (e.g. "42" or "#42")
    if (!card) {
      const bareNumber = clean.replace(/^#/, "");
      const num = parseInt(bareNumber, 10);
      if (!isNaN(num) && String(num) === bareNumber) {
        card = await db.card.findFirst({
          where: { number: num, projectId },
          include,
        });
      }
    }

    if (!card) {
      return { success: false, error: "Card not found", kind: "not_found" as ServiceErrorKind };
    }

    return {
      success: true,
      data: {
        ...card,
        identifier: `${card.project.key}-${card.number}`,
      },
    };
  } catch (error) {
    console.error(`Error looking up card by param '${param}' in project '${projectId}':`, error);
    return { success: false, error: "Failed to fetch card", kind: "internal" as ServiceErrorKind };
  }
}

export async function addCardLink(cardId: string, url: string, title: string | undefined, userId: string) {
  try {
    const parsedUrl = SafeUrlSchema.safeParse(url);
    if (!parsedUrl.success) {
      return { success: false, error: INVALID_LINK_URL_ERROR, kind: "invalid" as ServiceErrorKind };
    }
    url = parsedUrl.data;

    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
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
    return { success: false, error: "Failed to add card link", kind: "internal" as ServiceErrorKind };
  }
}

export interface ReorderItem {
  id: string;
  order: number;
  columnId?: string;
}

export async function reorderCards(rawItems: ReorderItem[], userId: string) {
  try {
    const parsed = parseInput(CardReorderSchema, { items: rawItems });
    if (!parsed.success) return parsed;
    const { items } = parsed.data;

    const cardIds = items.map((i) => i.id);
    const existingCards = await db.card.findMany({
      where: {
        id: { in: cardIds },
      },
      select: {
        id: true,
        projectId: true,
        completedAt: true,
        columnId: true,
        column: { select: { name: true } },
      },
    });

    if (existingCards.length !== cardIds.length) {
      return { success: false, error: "Unauthorized or card not found", kind: "not_found" as ServiceErrorKind };
    }

    for (const card of existingCards) {
      const denied = await accessDenial(card.projectId, userId, "MEMBER");
      if (denied) {
        return { success: false, error: "Unauthorized or card not found", kind: denied as ServiceErrorKind };
      }
    }

    const cardById = new Map(existingCards.map((c) => [c.id, c]));
    const columnIds = [...new Set(items.map((i) => i.columnId).filter((id): id is string => !!id))];
    const columns = await db.column.findMany({
      where: { id: { in: columnIds } },
      select: { id: true, projectId: true, isDone: true, name: true },
    });
    const columnById = new Map(columns.map((c) => [c.id, c]));
    for (const item of items) {
      if (item.columnId && columnById.get(item.columnId)?.projectId !== cardById.get(item.id)!.projectId) {
        return { success: false, error: "Invalid column", kind: "invalid" as ServiceErrorKind };
      }
    }

    const movedActivities: Array<{
      cardId: string;
      projectId: string;
      actorUserId: string;
      type: string;
      fromValue?: string | null;
      toValue?: string | null;
    }> = [];
    for (const item of items) {
      if (item.columnId) {
        const existingCard = cardById.get(item.id);
        if (existingCard && existingCard.columnId !== item.columnId) {
          const fromCol = existingCard.column?.name;
          const toCol = columnById.get(item.columnId)?.name;
          movedActivities.push({
            cardId: item.id,
            projectId: existingCard.projectId,
            actorUserId: userId,
            type: "moved",
            fromValue: fromCol,
            toValue: toCol,
          });
        }
      }
    }

    const updates = items.map((item) => {
      const completedAt = item.columnId
        ? deriveCompletedAt(columnById.get(item.columnId)?.isDone, cardById.get(item.id)!.completedAt)
        : undefined;
      return db.card.update({
        where: { id: item.id },
        data: {
          order: item.order,
          ...(item.columnId ? { columnId: item.columnId } : {}),
          ...(completedAt !== undefined ? { completedAt } : {}),
        },
      });
    });

    if (movedActivities.length > 0) {
      await db.$transaction([...updates, createActivities(db, movedActivities)]);
      for (const act of movedActivities) {
        notifyActivity(act.projectId, [act]);
      }
    } else {
      await db.$transaction(updates);
    }
    const projectIds = new Set(existingCards.map((c) => c.projectId));
    for (const projectId of projectIds) {
      safeRevalidatePath(`/projects/${projectId}`);
    }
    return { success: true };
  } catch (error) {
    console.error("Error reordering cards:", error);
    return { success: false, error: "Failed to reorder cards", kind: "internal" as ServiceErrorKind };
  }
}

export async function removeCardLink(linkId: string, userId: string) {
  try {
    const link = await db.cardLink.findUnique({
      where: { id: linkId },
      include: { card: { include: { project: true } } },
    });

    if (!link) {
      return { success: false, error: "Unauthorized or link not found", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(link.card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized or link not found", kind: denied as ServiceErrorKind };
    }

    await db.cardLink.delete({ where: { id: linkId } });
    safeRevalidatePath(`/projects/${link.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Error removing card link:", error);
    return { success: false, error: "Failed to remove card link", kind: "internal" as ServiceErrorKind };
  }
}
