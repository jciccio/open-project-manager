import { db } from "@/lib/db";

export async function getCardActivity(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== userId) {
      return { success: false, error: "Unauthorized or card not found" };
    }

    const activities = await db.activity.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: activities };
  } catch (error) {
    console.error("Error fetching card activity:", error);
    return { success: false, error: "Failed to fetch card activity" };
  }
}
