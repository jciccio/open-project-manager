"use server";

import { getSession } from "@/lib/auth";
import * as labelsService from "@/lib/services/labels";
import type { LabelDetailsInput } from "@/lib/validation/labels";
import type { ServiceErrorKind } from "@/lib/services/result";

export async function getLabels(projectId?: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return labelsService.getLabels(projectId, session.userId);
}

export async function createLabel(name: string, color?: string, projectId?: string, description?: string | null) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return labelsService.createLabel(name, color, projectId, session.userId, description);
}

export async function updateLabel(id: string, data: LabelDetailsInput) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return labelsService.updateLabel(id, data, session.userId);
}

export async function deleteLabel(id: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized", kind: "unauthenticated" as ServiceErrorKind };
  return labelsService.deleteLabel(id, session.userId);
}
