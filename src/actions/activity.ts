"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import * as activityService from "@/lib/services/activity";

export async function recordActivity(data: {
  cardId: string;
  actorUserId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}) {
  try {
    return await db.activity.create({
      data: {
        cardId: data.cardId,
        actorUserId: data.actorUserId,
        type: data.type,
        fromValue: data.fromValue !== undefined ? data.fromValue : null,
        toValue: data.toValue !== undefined ? data.toValue : null,
      },
    });
  } catch (err) {
    console.error("Error recording activity:", err);
    return null;
  }
}

export async function getCardActivity(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return activityService.getCardActivity(cardId, session.userId);
}
