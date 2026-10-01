"use server";

import { getSession } from "@/lib/auth";
import * as webhooksService from "@/lib/services/webhooks";

export async function listWebhooks(projectId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return webhooksService.listWebhooks(projectId, session.userId);
}

export async function createWebhook(projectId: string, data: { url: string; events: string[] }) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return webhooksService.createWebhook(projectId, data, session.userId);
}

export async function updateWebhook(
  id: string,
  data: { url?: string; events?: string[]; isActive?: boolean }
) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return webhooksService.updateWebhook(id, data, session.userId);
}

export async function deleteWebhook(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return webhooksService.deleteWebhook(id, session.userId);
}
