"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getProjectAccess, ProjectRole } from "@/lib/permissions";

export async function getProjectMembers(projectId: string, overrideUserId?: string) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const access = await getProjectAccess(projectId, session.userId, "VIEWER");
    if (!access.hasAccess) {
      return { success: false, error: "Project not found or access denied" };
    }

    const members = await db.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return { success: true, data: members, currentUserRole: access.role };
  } catch (error) {
    console.error(`Error fetching members for project ${projectId}:`, error);
    return { success: false, error: "Failed to fetch project members" };
  }
}

export async function addProjectMember(
  projectId: string,
  email: string,
  role: ProjectRole = "MEMBER",
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const access = await getProjectAccess(projectId, session.userId, "ADMIN");
    if (!access.hasAccess) {
      return { success: false, error: "Only project admins and owners can add members" };
    }

    if (role === "OWNER" && !access.isOwner) {
      return { success: false, error: "Only the project owner can assign the OWNER role" };
    }

    const targetUser = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!targetUser) {
      return { success: false, error: "No user found with that email address" };
    }

    const existingMember = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUser.id,
        },
      },
    });

    if (existingMember) {
      return { success: false, error: "User is already a member of this project" };
    }

    const member = await db.projectMember.create({
      data: {
        projectId,
        userId: targetUser.id,
        role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    try {
      revalidatePath(`/projects/${projectId}`);
    } catch {
      // Ignore in non-request contexts
    }

    return { success: true, data: member };
  } catch (error) {
    console.error(`Error adding member to project ${projectId}:`, error);
    return { success: false, error: "Failed to add project member" };
  }
}

export async function updateMemberRole(
  projectId: string,
  targetUserId: string,
  newRole: ProjectRole,
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const access = await getProjectAccess(projectId, session.userId, "ADMIN");
    if (!access.hasAccess) {
      return { success: false, error: "Only project admins and owners can update roles" };
    }

    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    // Cannot demote the original project creator
    if (project.userId === targetUserId && newRole !== "OWNER") {
      return { success: false, error: "Cannot change the role of the project creator" };
    }

    // Only owner can assign or demote OWNER role
    if ((newRole === "OWNER" || targetUserId === session.userId) && !access.isOwner) {
      return { success: false, error: "Only the project owner can manage OWNER roles" };
    }

    const member = await db.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
      data: { role: newRole },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    try {
      revalidatePath(`/projects/${projectId}`);
    } catch {
      // Ignore in non-request contexts
    }

    return { success: true, data: member };
  } catch (error) {
    console.error(`Error updating role in project ${projectId}:`, error);
    return { success: false, error: "Failed to update member role" };
  }
}

export async function removeProjectMember(
  projectId: string,
  targetUserId: string,
  overrideUserId?: string
) {
  try {
    const session = overrideUserId ? { userId: overrideUserId } : await getSession();
    if (!session) return { success: false, error: "Unauthorized" };

    const access = await getProjectAccess(projectId, session.userId, "VIEWER");
    if (!access.hasAccess) {
      return { success: false, error: "Unauthorized" };
    }

    const isSelfRemoval = session.userId === targetUserId;

    if (!isSelfRemoval && !access.isAdmin) {
      return { success: false, error: "Only project admins and owners can remove members" };
    }

    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    if (project.userId === targetUserId) {
      return { success: false, error: "Cannot remove the project creator from the project" };
    }

    const targetMember = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      return { success: false, error: "Member not found in project" };
    }

    if (targetMember.role === "OWNER" && !access.isOwner && !isSelfRemoval) {
      return { success: false, error: "Only the project owner can remove another owner" };
    }

    await db.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    try {
      revalidatePath(`/projects/${projectId}`);
    } catch {
      // Ignore in non-request contexts
    }

    return { success: true };
  } catch (error) {
    console.error(`Error removing member from project ${projectId}:`, error);
    return { success: false, error: "Failed to remove project member" };
  }
}
