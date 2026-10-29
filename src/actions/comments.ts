"use server";

import { getSession } from "@/lib/auth";
import * as commentsService from "@/lib/services/comments";

export async function listComments(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return commentsService.listComments(cardId, session.userId);
}

export async function addComment(cardId: string, authorOrContent: string, maybeContent?: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  const content = maybeContent !== undefined ? maybeContent : authorOrContent;
  const author = session.name || (maybeContent !== undefined ? authorOrContent : "Team Member");
  return commentsService.addComment(cardId, author, content, session.userId);
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
