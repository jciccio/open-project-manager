"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getLabels() {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const labels = await db.label.findMany({
      where: {
        OR: [
          { userId: session.userId },
          { userId: null },
        ],
      },
      orderBy: { name: "asc" },
    });
    return { success: true, data: labels };
  } catch (error) {
    console.error("Error fetching labels:", error);
    return { success: false, error: "Failed to fetch labels" };
  }
}

export async function createLabel(name: string, color?: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (!name.trim()) {
      return { success: false, error: "Label name is required" };
    }

    const label = await db.label.create({
      data: {
        userId: session.userId,
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

export async function deleteLabel(id: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const label = await db.label.findUnique({
      where: { id },
    });

    if (!label || (label.userId && label.userId !== session.userId)) {
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
