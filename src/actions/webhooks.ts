"use server";

import crypto from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhookEvents";

function invalidEvents(events: string[]): string[] {
  return events.filter((e) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e));
}

const WEBHOOK_SELECT = {
  id: true,
  projectId: true,
  url: true,
  eventsJson: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignore cache revalidation errors outside request context
  }
}

export async function listWebhooks(projectId: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const project = await db.project.findFirst({
      where: { id: projectId, userId: session.userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

    const webhooks = await db.webhook.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: WEBHOOK_SELECT,
    });

    return { success: true, data: webhooks };
  } catch (error) {
    console.error("Error listing webhooks:", error);
    return { success: false, error: "Failed to list webhooks" };
  }
}

export async function createWebhook(
  projectId: string,
  data: { url: string; events: string[] },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (!data.url || !data.url.trim()) {
      return { success: false, error: "Webhook URL is required" };
    }

    if (!Array.isArray(data.events) || data.events.length === 0) {
      return { success: false, error: "At least one event is required" };
    }

    const bad = invalidEvents(data.events);
    if (bad.length > 0) {
      return { success: false, error: `Unknown event type(s): ${bad.join(", ")}` };
    }

    const project = await db.project.findFirst({
      where: { id: projectId, userId: session.userId },
    });
    if (!project) return { success: false, error: "Project not found or access denied" };

    const secret = crypto.randomBytes(32).toString("hex");

    const webhook = await db.webhook.create({
      data: {
        projectId,
        url: data.url.trim(),
        secret,
        eventsJson: JSON.stringify(data.events),
      },
    });

    safeRevalidatePath(`/projects/${projectId}`);

    return {
      success: true,
      data: {
        id: webhook.id,
        projectId: webhook.projectId,
        url: webhook.url,
        secret: webhook.secret,
        eventsJson: webhook.eventsJson,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      },
    };
  } catch (error) {
    console.error("Error creating webhook:", error);
    return { success: false, error: "Failed to create webhook" };
  }
}

export async function updateWebhook(
  id: string,
  data: { url?: string; events?: string[]; isActive?: boolean },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existing = await db.webhook.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== session.userId) {
      return { success: false, error: "Webhook not found or access denied" };
    }

    if (data.events !== undefined) {
      if (!Array.isArray(data.events) || data.events.length === 0) {
        return { success: false, error: "At least one event is required" };
      }
      const bad = invalidEvents(data.events);
      if (bad.length > 0) {
        return { success: false, error: `Unknown event type(s): ${bad.join(", ")}` };
      }
    }

    const webhook = await db.webhook.update({
      where: { id },
      data: {
        url: data.url !== undefined ? data.url.trim() : undefined,
        eventsJson: data.events !== undefined ? JSON.stringify(data.events) : undefined,
        isActive: data.isActive !== undefined ? data.isActive : undefined,
      },
      select: WEBHOOK_SELECT,
    });

    safeRevalidatePath(`/projects/${existing.projectId}`);

    return { success: true, data: webhook };
  } catch (error) {
    console.error(`Error updating webhook ${id}:`, error);
    return { success: false, error: "Failed to update webhook" };
  }
}

export async function deleteWebhook(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const existing = await db.webhook.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || existing.project.userId !== session.userId) {
      return { success: false, error: "Webhook not found or access denied" };
    }

    await db.webhook.delete({ where: { id } });

    safeRevalidatePath(`/projects/${existing.projectId}`);

    return { success: true, deletedId: id };
  } catch (error) {
    console.error(`Error deleting webhook ${id}:`, error);
    return { success: false, error: "Failed to delete webhook" };
  }
}
