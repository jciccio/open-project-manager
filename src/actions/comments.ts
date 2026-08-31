"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as commentsService from "@/lib/services/comments";

export async function listComments(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.listComments(cardId, session.userId);
}

export async function addComment(cardId: string, author: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.addComment(cardId, author?.trim() || session.name || "Team Member", content, session.userId);
}

export async function deleteComment(commentId: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false as const, error: "Unauthorized" };

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        card: { include: { project: true } },
      },
    });

    if (!comment || comment.card.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    await db.comment.delete({
      where: { id: commentId },
    });

    revalidatePath(`/projects/${comment.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting comment ${commentId}:`, error);
    return { success: false, error: "Failed to delete comment" };
  }
}

export async function updateComment(commentId: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.updateComment(commentId, content, session.userId);
}
