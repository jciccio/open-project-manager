import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { recordActivity } from "@/actions/activity";

export async function listComments(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== userId) {
      return { success: false, error: "Card not found or access denied" };
    }

    const comments = await db.comment.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: comments };
  } catch (error) {
    console.error("Error listing comments:", error);
    return { success: false, error: "Failed to list comments" };
  }
}

export async function addComment(cardId: string, author: string, content: string, userId: string) {
  try {
    if (!content.trim()) {
      return { success: false, error: "Comment content cannot be empty" };
    }

    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || card.project.userId !== userId) {
      return { success: false, error: "Unauthorized" };
    }

    const comment = await db.comment.create({
      data: {
        cardId,
        author: author.trim() || "Team Member",
        content: content.trim(),
      },
    });

    await recordActivity({
      cardId,
      actorUserId: userId,
      type: "comment_added",
      toValue: content.trim().slice(0, 100),
    });

    safeRevalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: comment };
  } catch (error) {
    console.error("Error adding comment:", error);
    return { success: false, error: "Failed to add comment" };
  }
}

export async function deleteComment(commentId: string, userId: string) {
  try {
    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        card: { include: { project: true } },
      },
    });

    if (!comment || comment.card.project.userId !== userId) {
      return { success: false, error: "Unauthorized" };
    }

    await db.comment.delete({
      where: { id: commentId },
    });

    safeRevalidatePath(`/projects/${comment.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting comment ${commentId}:`, error);
    return { success: false, error: "Failed to delete comment" };
  }
}

export async function updateComment(commentId: string, content: string, userId: string) {
  try {
    if (!content.trim()) {
      return { success: false, error: "Comment content cannot be empty" };
    }

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        card: { include: { project: true } },
      },
    });

    if (!comment || comment.card.project.userId !== userId) {
      return { success: false, error: "Unauthorized" };
    }

    const updatedComment = await db.comment.update({
      where: { id: commentId },
      data: {
        content: content.trim(),
      },
    });

    safeRevalidatePath(`/projects/${comment.card.projectId}`);
    return { success: true, data: updatedComment };
  } catch (error) {
    console.error(`Error updating comment ${commentId}:`, error);
    return { success: false, error: "Failed to update comment" };
  }
}
