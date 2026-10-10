import fs from "fs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAttachmentFilePath } from "@/lib/attachmentStorage";

export async function removeAttachmentFiles(storageKeys: string[]): Promise<void> {
  const results = await Promise.allSettled(storageKeys.map((key) => fs.promises.unlink(getAttachmentFilePath(key))));
  for (const result of results) {
    if (result.status === "rejected" && (result.reason as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error("Failed to delete attachment file from disk:", result.reason);
    }
  }
}

// Card, column and project deletes cascade the Attachment rows in the
// database, so the files have to be collected before the rows are gone.
export async function deleteRowsAndAttachmentFiles<T>(
  attachments: Prisma.AttachmentWhereInput,
  deleteRows: () => Promise<T>
): Promise<T> {
  const storageKeys = (await db.attachment.findMany({ where: attachments, select: { storageKey: true } })).map(
    (a) => a.storageKey
  );
  const result = await deleteRows();
  await removeAttachmentFiles(storageKeys);
  return result;
}
