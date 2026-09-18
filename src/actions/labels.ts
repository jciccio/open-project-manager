"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";

export async function getLabels(projectId?: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
      if (!hasAccess) return { success: false, error: "Unauthorized" };
    }

    const where: any = projectId
      ? { OR: [{ projectId }, { userId: session.userId }, { userId: null, projectId: null }] }
      : { OR: [{ userId: session.userId }, { userId: null }] };

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

export async function createLabel(name: string, color?: string, projectId?: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (!name.trim()) {
      return { success: false, error: "Label name is required" };
    }

    if (projectId) {
      const hasAccess = await verifyProjectAccess(projectId, session.userId, "MEMBER");
      if (!hasAccess) return { success: false, error: "Unauthorized" };
    }

    const label = await db.label.create({
      data: {
        projectId: projectId || null,
        userId: projectId ? null : session.userId,
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

export async function deleteLabel(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const label = await db.label.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!label) return { success: false, error: "Unauthorized" };

    // Project-scoped label: ADMIN on project may delete it.
    // Personal label: only its own creator may delete it.
    const isAuthorized = label.projectId
      ? await verifyProjectAccess(label.projectId, session.userId, "ADMIN")
      : label.userId === session.userId;
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

