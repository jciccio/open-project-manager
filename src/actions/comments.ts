"use server";

import { getSession } from "@/lib/auth";
import * as commentsService from "@/lib/services/comments";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function listComments(cardId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return commentsService.listComments(cardId, session.userId);
}

export async function addComment(cardId: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return commentsService.addComment(cardId, content, session.userId);
}

export async function deleteComment(commentId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return commentsService.deleteComment(commentId, session.userId);
}

export async function updateComment(commentId: string, content: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return commentsService.updateComment(commentId, content, session.userId);
}
