import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getCardTypes(projectId: string, userId: string) {
  try {
    const project = await db.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

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
  icon: string | undefined,
  color: string | undefined,
  userId: string
) {
  try {
    if (!name.trim()) {
      return { success: false, error: "Type name is required" };
    }

    const project = await db.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

    const cardType = await db.cardType.create({
      data: {
        projectId,
        name: name.trim(),
        icon: icon || "Tag",
        color: color || "#6366f1",
      },
    });

    revalidatePath("/");
    return { success: true, data: cardType };
  } catch (error) {
    console.error("Error creating card type:", error);
    return { success: false, error: "Failed to create card type or type already exists" };
  }
}

export async function updateCardType(
  id: string,
  data: { name?: string; icon?: string; color?: string },
  userId: string
) {
  try {
    const existing = await db.cardType.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== userId) {
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

    revalidatePath("/");
    return { success: true, data: cardType };
  } catch (error) {
    console.error(`Error updating card type ${id}:`, error);
    return { success: false, error: "Failed to update card type" };
  }
}

export async function deleteCardType(id: string, userId: string) {
  try {
    const existing = await db.cardType.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== userId) {
      return { success: false, error: "Card type not found or access denied" };
    }

    await db.cardType.delete({
      where: { id },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error(`Error deleting card type ${id}:`, error);
    return { success: false, error: "Failed to delete card type" };
  }
}
