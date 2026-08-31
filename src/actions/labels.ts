"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getLabels(projectId?: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (projectId) {
      const project = await db.project.findFirst({ where: { id: projectId, userId: session.userId } });
      if (!project) return { success: false, error: "Unauthorized" };
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
      const project = await db.project.findFirst({ where: { id: projectId, userId: session.userId } });
      if (!project) return { success: false, error: "Unauthorized" };
    }

    const label = await db.label.create({
      data: {
        projectId: projectId || null,
        userId: projectId ? null : session.userId,
        name: name.trim(),
        color: color || "#3b82f6",
      },
    });

    revalidatePath("/");
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

    // Project-scoped label: only the owning project's user may delete it.
    // Personal label: only its own creator may delete it.
    // Global label (both null): not deletable here — there's no admin
    // concept in this app, so nobody should be able to remove a label
    // every user relies on.
    const isOwnedByCaller = label.projectId
      ? label.project?.userId === session.userId
      : label.userId === session.userId;
    if (!isOwnedByCaller) {
      return { success: false, error: "Unauthorized" };
    }

    await db.label.delete({
      where: { id },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error(`Error deleting label ${id}:`, error);
    return { success: false, error: "Failed to delete label" };
  }
}
