import type { Prisma } from "@prisma/client";
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

export interface ActivityEntry {
  cardId: string;
  actorUserId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}

function normalize(entry: ActivityEntry) {
  return {
    cardId: entry.cardId,
    actorUserId: entry.actorUserId,
    type: entry.type,
    fromValue: entry.fromValue ?? null,
    toValue: entry.toValue ?? null,
  };
}

// Pass the client of the transaction that makes the change, so the change and
// its history commit or roll back together.
export function createActivities(client: Prisma.TransactionClient, entries: ActivityEntry[]) {
  return client.activity.createMany({ data: entries.map(normalize) });
}

// Call only after the change has committed: a webhook must never announce a
// change that rolled back.
export function notifyActivity(projectId: string, entries: ActivityEntry[]) {
  for (const entry of entries.map(normalize)) {
    triggerWebhooks(projectId, entry.type, {
      cardId: entry.cardId,
      actorUserId: entry.actorUserId,
      fromValue: entry.fromValue,
      toValue: entry.toValue,
    });
  }
}
