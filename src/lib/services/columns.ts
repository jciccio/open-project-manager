import { db } from "@/lib/db";
import { deleteRowsAndAttachmentFiles } from "@/lib/attachmentCleanup";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import {
  parseColumnCreate,
  parseColumnUpdate,
  type ColumnDetailsInput,
  type ColumnUpdateInput,
} from "@/lib/validation/columns";
import { lastColumnError } from "@/lib/columnGuards";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function createColumn(
  projectId: string,
  name: string,
  details: ColumnDetailsInput,
  userId: string
) {
  try {
    const denied = await accessDenial(projectId, userId, "ADMIN");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    if (!name.trim()) {
      return { success: false, error: "Column name is required", kind: "invalid" as ServiceErrorKind };
    }

    const parsed = parseColumnCreate({ ...details, name });
    if (!parsed.success) {
      return { success: false, error: parsed.error, kind: "invalid" as ServiceErrorKind };
    }

    const lastColumn = await db.column.findFirst({
      where: { projectId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastColumn ? lastColumn.order + 1 : 0;

    const column = await db.column.create({
      data: {
        projectId,
        name: parsed.data.name,
        order: newOrder,
        isDone: parsed.isDone,
        group: parsed.group,
        color: parsed.data.color,
        description: parsed.data.description,
      },
    });

    safeRevalidatePath(`/projects/${projectId}`);
    return { success: true, data: column };
  } catch (error) {
    console.error("Error creating column:", error);
    return { success: false, error: "Failed to create column", kind: "internal" as ServiceErrorKind };
  }
}

export async function updateColumn(
  id: string,
  input: ColumnUpdateInput,
  userId: string
) {
  try {
    const column = await db.column.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!column) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(column.projectId, userId, "ADMIN");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const parsed = parseColumnUpdate(input, column.group);
    if (!parsed.success) {
      return { success: false, error: parsed.error, kind: "invalid" as ServiceErrorKind };
    }
    const data = parsed.data;

    const updated = await db.$transaction(async (tx) => {
      const updatedColumn = await tx.column.update({
        where: { id },
        data: {
          name: data.name,
          order: data.order,
          isDone: parsed.isDone,
          group: parsed.group,
          color: data.color,
          description: data.description,
        },
      });

      if (parsed.isDone !== column.isDone) {
        if (parsed.isDone) {
          await tx.card.updateMany({
            where: { columnId: id, completedAt: null },
            data: { completedAt: new Date() },
          });
        } else {
          await tx.card.updateMany({
            where: { columnId: id },
            data: { completedAt: null },
          });
        }
      }
      return updatedColumn;
    });

    safeRevalidatePath(`/projects/${column.projectId}`);
    return { success: true, data: updated };
  } catch (error) {
    console.error(`Error updating column ${id}:`, error);
    return { success: false, error: "Failed to update column", kind: "internal" as ServiceErrorKind };
  }
}

export async function reorderColumns(projectId: string, orderedColumnIds: string[], userId: string) {
  try {
    const denied = await accessDenial(projectId, userId, "ADMIN");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const ownedCount = await db.column.count({ where: { id: { in: orderedColumnIds }, projectId } });
    if (new Set(orderedColumnIds).size !== orderedColumnIds.length || ownedCount !== orderedColumnIds.length) {
      return { success: false, error: "Invalid column", kind: "invalid" as ServiceErrorKind };
    }

    const updates = orderedColumnIds.map((id, index) =>
      db.column.update({
        where: { id },
        data: { order: index },
      })
    );

    await db.$transaction(updates);
    safeRevalidatePath(`/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Error reordering columns:", error);
    return { success: false, error: "Failed to reorder columns", kind: "internal" as ServiceErrorKind };
  }
}

export async function deleteColumn(id: string, userId: string) {
  try {
    const column = await db.column.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!column) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(column.projectId, userId, "ADMIN");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const lastColumn = await lastColumnError(column.projectId);
    if (lastColumn) {
      return { success: false, error: lastColumn, kind: "invalid" as ServiceErrorKind };
    }

    await deleteRowsAndAttachmentFiles({ card: { columnId: id } }, () =>
      db.column.delete({
        where: { id },
      })
    );

    safeRevalidatePath(`/projects/${column.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting column ${id}:`, error);
    return { success: false, error: "Failed to delete column", kind: "internal" as ServiceErrorKind };
  }
}
