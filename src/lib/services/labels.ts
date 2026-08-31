import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getLabels(projectId: string | undefined, userId: string) {
  try {
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

    const label = await db.label.create({
      data: {
        projectId: projectId || null,
        userId: projectId ? null : userId,
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

export async function deleteLabel(id: string, userId: string) {
  try {
    const label = await db.label.findUnique({
      where: { id },
    });

    if (!label || (label.userId && label.userId !== userId)) {
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
