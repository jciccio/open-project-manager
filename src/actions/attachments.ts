"use server";

import { getSession } from "@/lib/auth";
import * as attachmentsService from "@/lib/services/attachments";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function uploadAttachment(data: {
  cardId: string;
  filename: string;
  contentBuffer: Buffer;
  mimeType?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  }
  return attachmentsService.uploadAttachment(
    {
      ...data,
      uploadedBy: session.userId,
    },
    session.userId
  );
}

export async function listAttachments(cardId: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  }
  return attachmentsService.listAttachments(cardId, session.userId);
}

export async function deleteAttachment(attachmentId: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  }
  return attachmentsService.deleteAttachment(attachmentId, session.userId);
}
