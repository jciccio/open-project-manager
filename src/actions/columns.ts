"use server";

import { getSession } from "@/lib/auth";
import * as columnsService from "@/lib/services/columns";

export async function createColumn(projectId: string, name: string, isDone?: boolean) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return columnsService.createColumn(projectId, name, isDone, session.userId);
}

export async function updateColumn(id: string, data: { name?: string; order?: number; isDone?: boolean }) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return columnsService.updateColumn(id, data, session.userId);
}

export async function reorderColumns(projectId: string, orderedColumnIds: string[]) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return columnsService.reorderColumns(projectId, orderedColumnIds, session.userId);
}

export async function deleteColumn(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return columnsService.deleteColumn(id, session.userId);
}
