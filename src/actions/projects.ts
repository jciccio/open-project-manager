"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getProjects(isArchived = false, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const projects = await db.project.findMany({
      where: {
        userId: session.userId,
        isArchived,
      },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            cards: true,
            columns: true,
          },
        },
      },
    });

    const archivedCount = await db.project.count({
      where: {
        userId: session.userId,
        isArchived: true,
      },
    });

    return { success: true, data: projects, archivedCount };
  } catch (error) {
    console.error("Error fetching projects:", error);
    return { success: false, error: "Failed to fetch projects" };
  }
}

export async function getProjectById(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const project = await db.project.findFirst({
      where: {
        id,
        userId: session.userId,
      },
      include: {
        columns: {
          orderBy: { order: "asc" },
          include: {
            cards: {
              orderBy: { order: "asc" },
              include: {
                labels: {
                  include: {
                    label: true,
                  },
                },
                comments: {
                  orderBy: { createdAt: "desc" },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found or access denied" };
    }

    return { success: true, data: project };
  } catch (error) {
    console.error(`Error fetching project ${id}:`, error);
    return { success: false, error: "Failed to fetch project details" };
  }
}

export async function generateProjectKey(name: string, requestedKey?: string): Promise<string> {
  if (requestedKey && requestedKey.trim()) {
    return requestedKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((w) => w[0].toUpperCase()).join("");
    return initials.slice(0, 6);
  }
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return clean.slice(0, 4) || "PROJ";
}

export async function createProject(
  data: { name: string; description?: string; color?: string; key?: string },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    if (!data.name.trim()) {
      return { success: false, error: "Project name is required" };
    }

    const projectKey = await generateProjectKey(data.name, data.key);

    const project = await db.project.create({
      data: {
        userId: session.userId,
        name: data.name.trim(),
        key: projectKey,
        description: data.description,
        color: data.color || "#6366f1",
        columns: {
          create: [
            { name: "Backlog", order: 0 },
            { name: "To Do", order: 1 },
            { name: "In Progress", order: 2 },
            { name: "Done", order: 3 },
          ],
        },
      },
    });

    revalidatePath("/");
    return { success: true, data: project };
  } catch (error) {
    console.error("Error creating project:", error);
    return { success: false, error: "Failed to create project" };
  }
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; color?: string },
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const existing = await db.project.findFirst({
      where: { id, userId: session.userId },
    });

    if (!existing) {
      return { success: false, error: "Project not found or access denied" };
    }

    const project = await db.project.update({
      where: { id },
      data,
    });

    revalidatePath("/");
    revalidatePath("/archived");
    revalidatePath(`/projects/${id}`);
    return { success: true, data: project };
  } catch (error) {
    console.error(`Error updating project ${id}:`, error);
    return { success: false, error: "Failed to update project" };
  }
}

export async function archiveProject(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const existing = await db.project.findFirst({
      where: { id, userId: session.userId },
    });

    if (!existing) {
      return { success: false, error: "Project not found or access denied" };
    }

    const project = await db.project.update({
      where: { id },
      data: { isArchived: true },
    });

    revalidatePath("/");
    revalidatePath("/archived");
    revalidatePath(`/projects/${id}`);
    return { success: true, data: project };
  } catch (error) {
    console.error(`Error archiving project ${id}:`, error);
    return { success: false, error: "Failed to archive project" };
  }
}

export async function unarchiveProject(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const existing = await db.project.findFirst({
      where: { id, userId: session.userId },
    });

    if (!existing) {
      return { success: false, error: "Project not found or access denied" };
    }

    const project = await db.project.update({
      where: { id },
      data: { isArchived: false },
    });

    revalidatePath("/");
    revalidatePath("/archived");
    revalidatePath(`/projects/${id}`);
    return { success: true, data: project };
  } catch (error) {
    console.error(`Error unarchiving project ${id}:`, error);
    return { success: false, error: "Failed to restore project" };
  }
}

export async function deleteProject(id: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const existing = await db.project.findFirst({
      where: { id, userId: session.userId },
    });

    if (!existing) {
      return { success: false, error: "Project not found or access denied" };
    }

    await db.project.delete({
      where: { id },
    });

    revalidatePath("/");
    revalidatePath("/archived");
    return { success: true };
  } catch (error) {
    console.error(`Error deleting project ${id}:`, error);
    return { success: false, error: "Failed to delete project" };
  }
}
