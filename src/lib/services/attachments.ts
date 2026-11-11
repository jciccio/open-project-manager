import { db } from "@/lib/db";
import { removeAttachmentFiles } from "@/lib/attachmentCleanup";
import { safeRevalidatePath } from "@/lib/revalidate";
import fs from "fs";
import { MAX_ATTACHMENT_BYTES, getAttachmentFilePath, writeAttachmentFile } from "@/lib/attachmentStorage";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import type { ServiceErrorKind } from "@/lib/services/result";

async function verifyCardAccess(cardId: string, userId: string, minRole: "VIEWER" | "MEMBER" = "MEMBER") {
  const card = await db.card.findUnique({
    where: { id: cardId },
    include: { project: true },
  });
  if (!card) return { denied: "not_found" as const };
  const denied = await accessDenial(card.projectId, userId, minRole);
  return denied ? { denied } : { card };
}

export async function uploadAttachment(
  data: {
    cardId: string;
    filename: string;
    contentBuffer: Buffer;
    mimeType?: string;
    uploadedBy?: string;
  },
  userId: string
) {
  try {
    const { card, denied } = await verifyCardAccess(data.cardId, userId);
    if (!card) {
      return { success: false, error: "Card not found or access denied", kind: denied as ServiceErrorKind };
    }

    if (data.contentBuffer.length > MAX_ATTACHMENT_BYTES) {
      return { success: false, error: `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB attachment size limit`, kind: "invalid" as ServiceErrorKind };
    }

    const storageKey = writeAttachmentFile(data.filename, data.contentBuffer);
    const filePath = getAttachmentFilePath(storageKey);

    let updated;
    try {
      updated = await db.$transaction(async (tx) => {
        const attachment = await tx.attachment.create({
          data: {
            cardId: data.cardId,
            filename: data.filename,
            storageKey,
            url: "",
            size: data.contentBuffer.length,
            mimeType: data.mimeType || null,
            uploadedBy: userId,
          },
        });

        return tx.attachment.update({
          where: { id: attachment.id },
          data: { url: `/api/v1/attachments/${attachment.id}` },
        });
      });
    } catch (error) {
      await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }

    safeRevalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: updated };
  } catch (error) {
    console.error("Error uploading attachment:", error);
    return { success: false, error: "Failed to upload attachment", kind: "internal" as ServiceErrorKind };
  }
}

export async function listAttachments(cardId: string, userId: string) {
  try {
    const { card, denied } = await verifyCardAccess(cardId, userId, "VIEWER");
    if (!card) {
      return { success: false, error: "Card not found or access denied", kind: denied as ServiceErrorKind };
    }

    const attachments = await db.attachment.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: attachments };
  } catch (error) {
    console.error("Error listing attachments:", error);
    return { success: false, error: "Failed to list attachments", kind: "internal" as ServiceErrorKind };
  }
}

export async function deleteAttachment(attachmentId: string, userId: string) {
  try {
    const attachment = await db.attachment.findFirst({
      where: { id: attachmentId },
      include: { card: { include: { project: true } } },
    });

    if (!attachment) {
      return { success: false, error: "Attachment not found or access denied", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(attachment.card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Attachment not found or access denied", kind: denied as ServiceErrorKind };
    }

    await db.attachment.delete({ where: { id: attachmentId } });

    await removeAttachmentFiles([attachment.storageKey]);

    safeRevalidatePath(`/projects/${attachment.card.projectId}`);
    return { success: true, data: { id: attachmentId } };
  } catch (error) {
    console.error("Error deleting attachment:", error);
    return { success: false, error: "Failed to delete attachment", kind: "internal" as ServiceErrorKind };
  }
}
