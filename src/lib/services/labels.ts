import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";

export async function getLabels(projectId: string | undefined, userId: string) {
  try {
    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, userId, "VIEWER");
      if (!hasAccess) return { success: false, error: "Unauthorized" };
    }

    const where: any = projectId
      ? { OR: [{ projectId }, { userId }, { userId: null, projectId: null }] }
      : { OR: [{ userId }, { userId: null }] };

    const labels = await db.label.findMany({
      where,
      orderBy: { name: "asc" },
    });
    return { success: true, data: labels };
  } catch (error) {
    console.error("Error fetching labels:", error);
    return { success: false, error: "Failed to fetch labels" };
  }
}

export async function createLabel(name: string, color: string | undefined, projectId: string | undefined, userId: string) {
  try {
    if (!name.trim()) {
      return { success: false, error: "Label name is required" };
    }

    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, userId, "MEMBER");
      if (!hasAccess) return { success: false, error: "Unauthorized" };
    }

    const label = await db.label.create({
      data: {
        projectId: projectId || null,
        userId: projectId ? null : userId,
        name: name.trim(),
        color: color || "#3b82f6",
      },
    });

    safeRevalidatePath("/");
    if (projectId) safeRevalidatePath(`/projects/${projectId}`);
    return { success: true, data: label };
  } catch (error) {
    console.error("Error creating label:", error);
    return { success: false, error: "Failed to create label or label exists" };
  }
}

export async function deleteLabel(id: string, userId: string) {
  try {
    const label = await db.label.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!label) return { success: false, error: "Unauthorized" };

    // Project-scoped label: ADMIN on project may delete it.
    // Personal label: only its own creator may delete it.
    const isAuthorized = label.projectId
      ? await verifyProjectAccess(label.projectId, userId, "ADMIN")
      : label.userId === userId;
    if (!isAuthorized) {
      return { success: false, error: "Unauthorized" };
    }

    await db.label.delete({
      where: { id },
    });

    safeRevalidatePath("/");
    if (label.projectId) safeRevalidatePath(`/projects/${label.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting label ${id}:`, error);
    return { success: false, error: "Failed to delete label" };
  }
}
