"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";

export async function getCardTypes(projectId: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const hasAccess = await verifyProjectAccess(projectId, session.userId, "VIEWER");
    if (!hasAccess) return { success: false, error: "Project not found or access denied" };

    const cardTypes = await db.cardType.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    });
    return { success: true, data: cardTypes };
  } catch (error) {
    console.error("Error fetching card types:", error);
    return { success: false, error: "Failed to fetch card types" };
  }
}

export async function createCardType(
  name: string,
  projectId: string,
  icon?: string,
  color?: string,
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (!name.trim()) {
      return { success: false, error: "Type name is required" };
    }

    const hasAccess = await verifyProjectAccess(projectId, session.userId, "ADMIN");
    if (!hasAccess) return { success: false, error: "Project not found or access denied" };

    const cardType = await db.cardType.create({
      data: {
        projectId,
        name: name.trim(),
        icon: icon || "Tag",
        color: color || "#6366f1",
      },
    });

    safeRevalidatePath(`/projects/${projectId}`);
    return { success: true, data: cardType };
  } catch (error) {
    console.error("Error creating card type:", error);
    return { success: false, error: "Failed to create card type or type already exists" };
  }
}

export async function updateCardType(
  id: string,
  data: { name?: string; icon?: string; color?: string },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existing = await db.cardType.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || !(await verifyProjectAccess(existing.projectId, session.userId, "ADMIN"))) {
      return { success: false, error: "Card type not found or access denied" };
    }

    const cardType = await db.cardType.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        icon: data.icon,
        color: data.color,
      },
    });

    safeRevalidatePath(`/projects/${existing.projectId}`);
    return { success: true, data: cardType };
  } catch (error) {
    console.error(`Error updating card type ${id}:`, error);
    return { success: false, error: "Failed to update card type" };
  }
}

export async function deleteCardType(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existing = await db.cardType.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || !(await verifyProjectAccess(existing.projectId, session.userId, "ADMIN"))) {
      return { success: false, error: "Card type not found or access denied" };
    }

    await db.cardType.delete({
      where: { id },
    });

    safeRevalidatePath(`/projects/${existing.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card type ${id}:`, error);
    return { success: false, error: "Failed to delete card type" };
  }
}

