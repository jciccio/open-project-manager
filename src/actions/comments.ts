"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addComment(
  cardId: string,
  author: string,
  content: string
) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    if (!content.trim()) {
      return { success: false, error: "Comment content cannot be empty" };
    }

    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== session.userId) {
      return { success: false, error: "Unauthorized" };
    }

    const comment = await db.comment.create({
      data: {
        cardId,
        author: author.trim() || session.name || "Team Member",
        content: content.trim(),
      },
    });

    revalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: comment };
  } catch (error) {
    console.error("Error adding comment:", error);
    return { success: false, error: "Failed to add comment" };
  }
}

export async function deleteComment(commentId: string) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

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
