"use server";

import { getSession } from "@/lib/auth";
import * as webhooksService from "@/lib/services/webhooks";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function listWebhooks(projectId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return webhooksService.listWebhooks(projectId, session.userId);
}

export async function createWebhook(projectId: string, data: { url: string; events: string[] }) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return webhooksService.createWebhook(projectId, data, session.userId);
}

export async function updateWebhook(
  id: string,
  data: { url?: string; events?: string[]; isActive?: boolean }
) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return webhooksService.updateWebhook(id, data, session.userId);
}

export async function deleteWebhook(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return webhooksService.deleteWebhook(id, session.userId);
}
