import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import {
  parseColumnCreate,
  parseColumnUpdate,
  type ColumnDetailsInput,
  type ColumnUpdateInput,
} from "@/lib/validation/columns";

export async function createColumn(
  projectId: string,
  name: string,
  details: ColumnDetailsInput,
  userId: string
) {
  try {
    if (!(await verifyProjectAccess(projectId, userId, "ADMIN"))) {
      return { success: false, error: "Unauthorized" };
    }

    if (!name.trim()) {
      return { success: false, error: "Column name is required" };
    }

    const parsed = parseColumnCreate({ ...details, name });
    if (!parsed.success) {
      return { success: false, error: parsed.error };
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
    return { success: false, error: "Failed to create column" };
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

    if (!column || !(await verifyProjectAccess(column.projectId, userId, "ADMIN"))) {
      return { success: false, error: "Unauthorized" };
    }

    const parsed = parseColumnUpdate(input, column.group);
    if (!parsed.success) {
      return { success: false, error: parsed.error };
    }
    const data = parsed.data;

    const updated = await db.column.update({
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
        await db.card.updateMany({
          where: { columnId: id, completedAt: null },
          data: { completedAt: new Date() },
        });
      } else {
        await db.card.updateMany({
          where: { columnId: id },
          data: { completedAt: null },
        });
      }
    }

    safeRevalidatePath(`/projects/${column.projectId}`);
    return { success: true, data: updated };
  } catch (error) {
    console.error(`Error updating column ${id}:`, error);
    return { success: false, error: "Failed to update column" };
  }
}

export async function reorderColumns(projectId: string, orderedColumnIds: string[], userId: string) {
  try {
    if (!(await verifyProjectAccess(projectId, userId, "ADMIN"))) {
      return { success: false, error: "Unauthorized" };
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
    return { success: false, error: "Failed to reorder columns" };
  }
}

export async function deleteColumn(id: string, userId: string) {
  try {
    const column = await db.column.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!column || !(await verifyProjectAccess(column.projectId, userId, "ADMIN"))) {
      return { success: false, error: "Unauthorized" };
    }

    await db.column.delete({
      where: { id },
    });

    safeRevalidatePath(`/projects/${column.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting column ${id}:`, error);
    return { success: false, error: "Failed to delete column" };
  }
}
