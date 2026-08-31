"use server";

import { getSession } from "@/lib/auth";
import * as projectsService from "@/lib/services/projects";

export { generateProjectKey } from "@/lib/services/projects";

export async function getProjects(isArchived = false) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.getProjects(session.userId, isArchived);
}

export async function getProjectById(id: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.getProjectById(id, session.userId);
}

export async function createProject(data: { name: string; description?: string; color?: string; key?: string }) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.createProject(data, session.userId);
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; color?: string }
) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.updateProject(id, data, session.userId);
}

export async function archiveProject(id: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.archiveProject(id, session.userId);
}

export async function unarchiveProject(id: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.unarchiveProject(id, session.userId);
}

export async function deleteProject(id: string) {
  const session = await getSession();
  if (!session) {
    return { success: false as const, error: "Unauthorized" };
  }
  return projectsService.deleteProject(id, session.userId);
}
