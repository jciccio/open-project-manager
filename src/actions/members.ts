"use server";

import { getSession } from "@/lib/auth";
import type { ProjectRole } from "@/lib/permissions";
import * as membersService from "@/lib/services/members";

export async function getProjectMembers(projectId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return membersService.getProjectMembers(projectId, session.userId);
}

export async function addProjectMember(projectId: string, email: string, role: ProjectRole = "MEMBER") {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return membersService.addProjectMember(projectId, email, role, session.userId);
}

export async function updateMemberRole(projectId: string, targetUserId: string, newRole: ProjectRole) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return membersService.updateMemberRole(projectId, targetUserId, newRole, session.userId);
}

export async function removeProjectMember(projectId: string, targetUserId: string) {
  const session = await getSession();
  if (!session) return { success: false as const, error: "Unauthorized" };
  return membersService.removeProjectMember(projectId, targetUserId, session.userId);
}
