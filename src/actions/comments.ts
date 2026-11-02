"use server";

import { getSession } from "@/lib/auth";
import * as commentsService from "@/lib/services/comments";

export async function listComments(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.listComments(cardId, session.userId);
}

export async function addComment(cardId: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.addComment(cardId, content, session.userId);
}

export async function deleteComment(commentId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.deleteComment(commentId, session.userId);
}

export async function updateComment(commentId: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.updateComment(commentId, content, session.userId);
}
