import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import { parseLabelDetails, type LabelDetailsInput } from "@/lib/validation/labels";
import { createScopedLabel, LabelExistsError } from "@/lib/scopedLabels";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function getLabels(projectId: string | undefined, userId: string) {
  try {
    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, userId, "VIEWER");
      if (!hasAccess) return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }

    const where: Prisma.LabelWhereInput = projectId
      ? { OR: [{ projectId }, { userId }, { userId: null, projectId: null }] }
      : { OR: [{ userId }, { userId: null }] };

    const labels = await db.label.findMany({
      where,
      orderBy: { name: "asc" },
    });
    return { success: true, data: labels };
  } catch (error) {
    console.error("Error fetching labels:", error);
    return { success: false, error: "Failed to fetch labels", kind: "internal" as ServiceErrorKind };
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
      return { success: false, error: "Label name is required", kind: "invalid" as ServiceErrorKind };
    }

    const details = parseLabelDetails({ color: color || undefined, description });
    if (!details.success) {
      return { success: false, error: details.error, kind: "invalid" as ServiceErrorKind };
    }

    if (projectId) {
      const denied = await accessDenial(projectId, userId, "MEMBER");
      if (denied) return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
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
    if (error instanceof LabelExistsError) return { success: false, error: error.message, kind: "conflict" as ServiceErrorKind };
    console.error("Error creating label:", error);
    return { success: false, error: "Failed to create label or label exists", kind: "internal" as ServiceErrorKind };
  }
}

async function findManageableLabel(id: string, userId: string) {
  const label = await db.label.findUnique({ where: { id } });
  if (!label) return { denied: "not_found" as const };

  // Project-scoped label: ADMIN on project may change or delete it.
  // Personal label: only its own creator may.
  if (label.projectId) {
    const denied = await accessDenial(label.projectId, userId, "ADMIN");
    return denied ? { denied } : { label };
  }
  return label.userId === userId ? { label } : { denied: "not_found" as const };
}

export async function updateLabel(id: string, input: LabelDetailsInput, userId: string) {
  try {
    const { label, denied } = await findManageableLabel(id, userId);
    if (!label) return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };

    const details = parseLabelDetails(input);
    if (!details.success) {
      return { success: false, error: details.error, kind: "invalid" as ServiceErrorKind };
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
    return { success: false, error: "Failed to update label", kind: "internal" as ServiceErrorKind };
  }
}

export async function deleteLabel(id: string, userId: string) {
  try {
    const { label, denied } = await findManageableLabel(id, userId);
    if (!label) return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };

    await db.label.delete({
      where: { id },
    });

    safeRevalidatePath("/");
    if (label.projectId) safeRevalidatePath(`/projects/${label.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting label ${id}:`, error);
    return { success: false, error: "Failed to delete label", kind: "internal" as ServiceErrorKind };
  }
}
