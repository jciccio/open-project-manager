"use server";

import { getSession } from "@/lib/auth";
import * as activityService from "@/lib/services/activity";

export async function getCardActivity(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return activityService.getCardActivity(cardId, session.userId);
}
