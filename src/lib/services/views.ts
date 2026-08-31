import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getSavedViews(projectId: string, userId: string) {
  try {
    const project = await db.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

    const savedViews = await db.savedView.findMany({
      where: { projectId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return { success: true, data: savedViews };
  } catch (error) {
    console.error("Error fetching saved views:", error);
    return { success: false, error: "Failed to fetch saved views" };
  }
}

export async function createSavedView(
  projectId: string,
  data: {
    name: string;
    filterJson?: string;
    isDefault?: boolean;
  },
  userId: string
) {
  try {
    if (!data.name || !data.name.trim()) {
      return { success: false, error: "View name is required" };
    }

    const project = await db.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

    // If setting as default, unset other defaults in the project
    if (data.isDefault) {
      await db.savedView.updateMany({
        where: { projectId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const savedView = await db.savedView.create({
      data: {
        projectId,
        name: data.name.trim(),
        filterJson: data.filterJson || "{}",
        isDefault: !!data.isDefault,
      },
    });

    try {
      revalidatePath(`/projects/${projectId}`);
    } catch {
      // Ignore revalidation outside request context
    }

    return { success: true, data: savedView };
  } catch (error) {
    console.error("Error creating saved view:", error);
    return { success: false, error: "Failed to create saved view or name already exists" };
  }
}

export async function updateSavedView(
  id: string,
  data: {
    name?: string;
    filterJson?: string;
    isDefault?: boolean;
  },
  userId: string
) {
  try {
    const existing = await db.savedView.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== userId) {
      return { success: false, error: "Saved view not found or access denied" };
    }

    if (data.isDefault) {
      await db.savedView.updateMany({
        where: { projectId: existing.projectId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const savedView = await db.savedView.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name.trim() : undefined,
        filterJson: data.filterJson !== undefined ? data.filterJson : undefined,
        isDefault: data.isDefault !== undefined ? data.isDefault : undefined,
      },
    });

    try {
      revalidatePath(`/projects/${existing.projectId}`);
    } catch {
      // Ignore revalidation outside request context
    }

    return { success: true, data: savedView };
  } catch (error) {
    console.error(`Error updating saved view ${id}:`, error);
    return { success: false, error: "Failed to update saved view" };
  }
}

export async function deleteSavedView(id: string, userId: string) {
  try {
    const existing = await db.savedView.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== userId) {
      return { success: false, error: "Saved view not found or access denied" };
    }

    await db.savedView.delete({
      where: { id },
    });

    try {
      revalidatePath(`/projects/${existing.projectId}`);
    } catch {
      // Ignore revalidation outside request context
    }

    return { success: true, deletedId: id };
  } catch (error) {
    console.error(`Error deleting saved view ${id}:`, error);
    return { success: false, error: "Failed to delete saved view" };
  }
}
