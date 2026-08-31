"use server";

import { getSession } from "@/lib/auth";
import * as viewsService from "@/lib/services/views";

export async function getSavedViews(projectId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return viewsService.getSavedViews(projectId, session.userId);
}

export async function createSavedView(
  projectId: string,
  data: {
    name: string;
    filterJson?: string;
    isDefault?: boolean;
  }
) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return viewsService.createSavedView(projectId, data, session.userId);
}

export async function updateSavedView(
  id: string,
  data: {
    name?: string;
    filterJson?: string;
    isDefault?: boolean;
  }
) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return viewsService.updateSavedView(id, data, session.userId);
}

export async function deleteSavedView(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return viewsService.deleteSavedView(id, session.userId);
}
