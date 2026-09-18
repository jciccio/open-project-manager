"use server";

import { getSession } from "@/lib/auth";
import * as attachmentsService from "@/lib/services/attachments";

export async function uploadAttachment(data: {
  cardId: string;
  filename: string;
  contentBuffer: Buffer;
  mimeType?: string;
  uploadedBy?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return attachmentsService.uploadAttachment(data, session.userId);
}

export async function listAttachments(cardId: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return attachmentsService.listAttachments(cardId, session.userId);
}

export async function deleteAttachment(attachmentId: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return attachmentsService.deleteAttachment(attachmentId, session.userId);
}
