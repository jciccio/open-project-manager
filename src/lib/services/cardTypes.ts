import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import { CardTypeCreateSchema, CardTypeUpdateSchema } from "@/lib/validation/cardTypes";
import { parseInput } from "@/lib/validation/errors";

export async function getCardTypes(projectId: string, userId: string) {
  try {
    const hasAccess = await verifyProjectAccess(projectId, userId, "VIEWER");
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
  icon: string | undefined,
  color: string | undefined,
  userId: string
) {
  try {
    const parsed = parseInput(CardTypeCreateSchema, { name, icon, color });
    if (!parsed.success) return parsed;
    const input = parsed.data;

    const hasAccess = await verifyProjectAccess(projectId, userId, "ADMIN");
    if (!hasAccess) return { success: false, error: "Project not found or access denied" };

    const cardType = await db.cardType.create({
      data: {
        projectId,
        name: input.name,
        icon: input.icon || "Tag",
        color: input.color || "#6366f1",
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
  userId: string
) {
  try {
    const parsed = parseInput(CardTypeUpdateSchema, data);
    if (!parsed.success) return parsed;

    const existing = await db.cardType.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || !(await verifyProjectAccess(existing.projectId, userId, "ADMIN"))) {
      return { success: false, error: "Card type not found or access denied" };
    }

    const cardType = await db.cardType.update({
      where: { id },
      data: parsed.data,
    });

    safeRevalidatePath(`/projects/${existing.projectId}`);
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
    if (!existing || !(await verifyProjectAccess(existing.projectId, userId, "ADMIN"))) {
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
