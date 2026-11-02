import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import { parseLabelDetails, type LabelDetailsInput } from "@/lib/validation/labels";
import { createScopedLabel, LabelExistsError } from "@/lib/scopedLabels";

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

export async function createLabel(
  name: string,
  color: string | undefined,
  projectId: string | undefined,
  userId: string,
  description?: string | null
) {
  try {
    if (!name.trim()) {
      return { success: false, error: "Label name is required" };
    }

    const details = parseLabelDetails({ color: color || undefined, description });
    if (!details.success) {
      return { success: false, error: details.error };
    }

    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, userId, "MEMBER");
      if (!hasAccess) return { success: false, error: "Unauthorized" };
    }

    const label = await createScopedLabel({
      projectId: projectId || null,
      userId: projectId ? null : userId,
      name,
      color: details.data.color || "#3b82f6",
      description: details.data.description ?? null,
    });

    safeRevalidatePath("/");
    if (projectId) safeRevalidatePath(`/projects/${projectId}`);
    return { success: true, data: label };
  } catch (error) {
    if (error instanceof LabelExistsError) return { success: false, error: error.message };
    console.error("Error creating label:", error);
    return { success: false, error: "Failed to create label or label exists" };
  }
}

async function findManageableLabel(id: string, userId: string) {
  const label = await db.label.findUnique({ where: { id } });
  if (!label) return null;

  // Project-scoped label: ADMIN on project may change or delete it.
  // Personal label: only its own creator may.
  const isAuthorized = label.projectId
    ? await verifyProjectAccess(label.projectId, userId, "ADMIN")
    : label.userId === userId;
  return isAuthorized ? label : null;
}

export async function updateLabel(id: string, input: LabelDetailsInput, userId: string) {
  try {
    const label = await findManageableLabel(id, userId);
    if (!label) return { success: false, error: "Unauthorized" };

    const details = parseLabelDetails(input);
    if (!details.success) {
      return { success: false, error: details.error };
    }

    const updated = await db.label.update({
      where: { id },
      data: { color: details.data.color, description: details.data.description },
    });

    safeRevalidatePath("/");
    if (label.projectId) safeRevalidatePath(`/projects/${label.projectId}`);
    return { success: true, data: updated };
  } catch (error) {
    console.error(`Error updating label ${id}:`, error);
    return { success: false, error: "Failed to update label" };
  }
}

export async function deleteLabel(id: string, userId: string) {
  try {
    const label = await findManageableLabel(id, userId);
    if (!label) return { success: false, error: "Unauthorized" };

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
