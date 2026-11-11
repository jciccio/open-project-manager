"use server";

import { getSession } from "@/lib/auth";
import * as activityService from "@/lib/services/activity";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function getCardActivity(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return activityService.getCardActivity(cardId, session.userId);
}
