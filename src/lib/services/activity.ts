import { db } from "@/lib/db";
import { verifyProjectAccess } from "@/lib/permissions";
import { triggerWebhooks } from "@/lib/webhooks";

export async function getCardActivity(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({ where: { id: cardId } });

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "VIEWER"))) {
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

export async function recordActivity(data: {
  cardId: string;
  projectId: string;
  actorUserId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}) {
  try {
    const activity = await db.activity.create({
      data: {
        cardId: data.cardId,
        actorUserId: data.actorUserId,
        type: data.type,
        fromValue: data.fromValue !== undefined ? data.fromValue : null,
        toValue: data.toValue !== undefined ? data.toValue : null,
      },
    });

    triggerWebhooks(data.projectId, data.type, {
      cardId: data.cardId,
      actorUserId: data.actorUserId,
      fromValue: activity.fromValue,
      toValue: activity.toValue,
    });

    return activity;
  } catch (err) {
    console.error("Error recording activity:", err);
    return null;
  }
}

export interface ActivityRecordData {
  cardId: string;
  projectId: string;
  actorUserId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}

export async function recordActivities(records: ActivityRecordData[]) {
  if (records.length === 0) return;
  try {
    const dataToInsert = records.map((r) => ({
      cardId: r.cardId,
      actorUserId: r.actorUserId,
      type: r.type,
      fromValue: r.fromValue !== undefined ? r.fromValue : null,
      toValue: r.toValue !== undefined ? r.toValue : null,
    }));

    await db.activity.createMany({
      data: dataToInsert,
    });

    for (const r of records) {
      triggerWebhooks(r.projectId, r.type, {
        cardId: r.cardId,
        actorUserId: r.actorUserId,
        fromValue: r.fromValue !== undefined ? r.fromValue : null,
        toValue: r.toValue !== undefined ? r.toValue : null,
      });
    }
  } catch (err) {
    console.error("Error batch recording activities:", err);
  }
}
