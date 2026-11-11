import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { verifyProjectAccess, accessDenial } from "@/lib/permissions";
import { CommentContentSchema } from "@/lib/validation/comments";
import { parseInput } from "@/lib/validation/errors";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function listComments(cardId: string, userId: string) {
  try {
    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card || !(await verifyProjectAccess(card.projectId, userId, "VIEWER"))) {
      return { success: false, error: "Card not found or access denied", kind: "not_found" as ServiceErrorKind };
    }

    const comments = await db.comment.findMany({
      where: { cardId },
      include: {
        authorUser: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: comments };
  } catch (error) {
    console.error("Error listing comments:", error);
    return { success: false, error: "Failed to list comments", kind: "internal" as ServiceErrorKind };
  }
}

export async function addComment(cardId: string, content: string, userId: string) {
  try {
    const parsedContent = parseInput(CommentContentSchema, content);
    if (!parsedContent.success) {
      return { success: false, error: parsedContent.error, kind: "invalid" as ServiceErrorKind };
    }

    const card = await db.card.findUnique({
      where: { id: cardId },
      include: { project: true },
    });

    if (!card) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const author = user?.name?.trim() || user?.email?.trim() || "Team Member";

    const activityEntries: ActivityEntry[] = [
      { cardId, actorUserId: userId, type: "comment_added", toValue: parsedContent.data.slice(0, 100) },
    ];

    const comment = await db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          cardId,
          author,
          authorUserId: userId,
          content: parsedContent.data,
        },
        include: {
          authorUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      await createActivities(tx, activityEntries);
      return created;
    });

    notifyActivity(card.projectId, activityEntries);

    safeRevalidatePath(`/projects/${card.projectId}`);
    return { success: true, data: comment };
  } catch (error) {
    console.error("Error adding comment:", error);
    return { success: false, error: "Failed to add comment", kind: "internal" as ServiceErrorKind };
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

    if (!comment) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(comment.card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    await db.comment.delete({
      where: { id: commentId },
    });

    safeRevalidatePath(`/projects/${comment.card.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting comment ${commentId}:`, error);
    return { success: false, error: "Failed to delete comment", kind: "internal" as ServiceErrorKind };
  }
}

export async function updateComment(commentId: string, content: string, userId: string) {
  try {
    const parsedContent = parseInput(CommentContentSchema, content);
    if (!parsedContent.success) {
      return { success: false, error: parsedContent.error, kind: "invalid" as ServiceErrorKind };
    }

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      include: {
        card: { include: { project: true } },
      },
    });

    if (!comment) {
      return { success: false, error: "Unauthorized", kind: "not_found" as ServiceErrorKind };
    }
    const denied = await accessDenial(comment.card.projectId, userId, "MEMBER");
    if (denied) {
      return { success: false, error: "Unauthorized", kind: denied as ServiceErrorKind };
    }

    const updatedComment = await db.comment.update({
      where: { id: commentId },
      data: {
        content: parsedContent.data,
      },
      include: {
        authorUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    safeRevalidatePath(`/projects/${comment.card.projectId}`);
    return { success: true, data: updatedComment };
  } catch (error) {
    console.error(`Error updating comment ${commentId}:`, error);
    return { success: false, error: "Failed to update comment", kind: "internal" as ServiceErrorKind };
  }
}
