"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads", "attachments");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

async function verifyCardAccess(cardId: string, userId: string) {
  const card = await db.card.findFirst({
    where: {
      id: cardId,
      project: { userId },
    },
    include: { project: true },
  });
  return card;
}

export async function uploadAttachment(data: {
  cardId: string;
  filename: string;
  contentBuffer: Buffer;
  mimeType?: string;
  uploadedBy?: string;
}, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const card = await verifyCardAccess(data.cardId, session.userId);
    if (!card) {
      return { success: false, error: "Card not found or access denied" };
    }

    ensureUploadsDir();

    const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniquePrefix = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const storageKey = `${uniquePrefix}-${sanitizedFilename}`;
    const filePath = path.join(UPLOADS_DIR, storageKey);

    fs.writeFileSync(filePath, data.contentBuffer);

    const publicUrl = `/uploads/attachments/${storageKey}`;

    const attachment = await db.attachment.create({
      data: {
        cardId: data.cardId,
        filename: data.filename,
        storageKey,
        url: publicUrl,
        size: data.contentBuffer.length,
        mimeType: data.mimeType || null,
        uploadedBy: data.uploadedBy || session.userId,
      },
    });

    revalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: attachment };
  } catch (error) {
    console.error("Error uploading attachment:", error);
    return { success: false, error: "Failed to upload attachment" };
  }
}

export async function listAttachments(cardId: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const card = await verifyCardAccess(cardId, session.userId);
    if (!card) {
      return { success: false, error: "Card not found or access denied" };
    }

    const attachments = await db.attachment.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: attachments };
  } catch (error) {
    console.error("Error listing attachments:", error);
    return { success: false, error: "Failed to list attachments" };
  }
}

export async function deleteAttachment(attachmentId: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const attachment = await db.attachment.findFirst({
      where: { id: attachmentId },
      include: { card: { include: { project: true } } },
    });

    if (!attachment || attachment.card.project.userId !== session.userId) {
      return { success: false, error: "Attachment not found or access denied" };
    }

    await db.attachment.delete({ where: { id: attachmentId } });

    const filePath = path.join(UPLOADS_DIR, attachment.storageKey);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Failed to delete attachment file from disk:", err);
      }
    }

    revalidatePath(`/projects/${attachment.card.projectId}`);
    return { success: true, data: { id: attachmentId } };
  } catch (error) {
    console.error("Error deleting attachment:", error);
    return { success: false, error: "Failed to delete attachment" };
  }
}
