"use server";

import { getSession } from "@/lib/auth";
import * as relationsService from "@/lib/services/relations";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function addCardRelation(sourceCardId: string, targetCardId: string, type: string = "BLOCKS") {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return relationsService.addCardRelation(sourceCardId, targetCardId, type, session.userId);
}

export async function removeCardRelation(relationId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return relationsService.removeCardRelation(relationId, session.userId);
}

export async function getCardRelations(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return relationsService.getCardRelations(cardId, session.userId);
}
