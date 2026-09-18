"use server";

import { getSession } from "@/lib/auth";
import * as cardTypesService from "@/lib/services/cardTypes";

export async function getCardTypes(projectId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardTypesService.getCardTypes(projectId, session.userId);
}

export async function createCardType(name: string, projectId: string, icon?: string, color?: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardTypesService.createCardType(name, projectId, icon, color, session.userId);
}

export async function updateCardType(id: string, data: { name?: string; icon?: string; color?: string }) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardTypesService.updateCardType(id, data, session.userId);
}

export async function deleteCardType(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return cardTypesService.deleteCardType(id, session.userId);
}
