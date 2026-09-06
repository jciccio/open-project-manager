"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeRevalidatePath } from "@/lib/revalidate";

async function verifyProjectOwnership(projectId: string, userId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId },
  });
  return !!project;
}

export async function createColumn(
  projectId: string,
  name: string,
  isDone?: boolean,
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session || !(await verifyProjectOwnership(projectId, session.userId))) {
      return { success: false, error: "Unauthorized" };
    }

    if (!name.trim()) {
      return { success: false, error: "Column name is required" };
    }

    const lastColumn = await db.column.findFirst({
      where: { projectId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastColumn ? lastColumn.order + 1 : 0;

    const column = await db.column.create({
      data: {
        projectId,
        name: name.trim(),
        order: newOrder,
        isDone: isDone ?? false,
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
  data: { name?: string; order?: number; isDone?: boolean },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const column = await db.column.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!column || column.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    const updated = await db.column.update({
      where: { id },
      data,
    });

    if (data.isDone !== undefined && data.isDone !== column.isDone) {
      if (data.isDone) {
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

export async function reorderColumns(
  projectId: string,
  orderedColumnIds: string[],
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session || !(await verifyProjectOwnership(projectId, session.userId))) {
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

export async function deleteColumn(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const column = await db.column.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!column || column.project.userId !== session.userId) {
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
