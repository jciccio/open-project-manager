"use server";

import { getSession } from "@/lib/auth";
import * as columnsService from "@/lib/services/columns";
import type { ColumnDetailsInput, ColumnUpdateInput } from "@/lib/validation/columns";

export async function createColumn(projectId: string, name: string, details: ColumnDetailsInput = {}) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return columnsService.createColumn(projectId, name, details, session.userId);
}

export async function updateColumn(id: string, data: ColumnUpdateInput) {
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
