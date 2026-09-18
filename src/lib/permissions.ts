import { db } from "@/lib/db";

export type ProjectRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type ProjectVisibility = "PRIVATE" | "INTERNAL";

export const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  OWNER: 40,
  ADMIN: 30,
  MEMBER: 20,
  VIEWER: 10,
};

export interface ProjectAccessResult {
  hasAccess: boolean;
  role: ProjectRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  error?: string;
}

/**
 * Checks a user's access level and role for a specific project.
 */
export async function getProjectAccess(
  projectId: string,
  userId: string,
  minimumRole: ProjectRole = "VIEWER"
): Promise<ProjectAccessResult> {
  if (!projectId || !userId) {
    return {
      hasAccess: false,
      role: null,
      isOwner: false,
      isAdmin: false,
      canEdit: false,
      error: "Invalid project or user ID",
    };
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      visibility: true,
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  });

  if (!project) {
    return {
      hasAccess: false,
      role: null,
      isOwner: false,
      isAdmin: false,
      canEdit: false,
      error: "Project not found",
    };
  }

  // 1. Check if user is the direct creator/owner of the project
  let userRole: ProjectRole | null = null;

  if (project.userId === userId) {
    userRole = "OWNER";
  } else if (project.members.length > 0) {
    userRole = project.members[0].role as ProjectRole;
  } else if (project.visibility === "INTERNAL") {
    // Authenticated users have read-only VIEWER access to internal projects
    userRole = "VIEWER";
  }

  if (!userRole) {
    return {
      hasAccess: false,
      role: null,
      isOwner: false,
      isAdmin: false,
      canEdit: false,
      error: "Access denied",
    };
  }

  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 10;
  const hasAccess = userLevel >= requiredLevel;

  return {
    hasAccess,
    role: userRole,
    isOwner: userRole === "OWNER",
    isAdmin: userRole === "OWNER" || userRole === "ADMIN",
    canEdit: userRole === "OWNER" || userRole === "ADMIN" || userRole === "MEMBER",
    error: hasAccess ? undefined : `Requires ${minimumRole} role`,
  };
}

/**
 * Simplified boolean check for project access.
 */
export async function verifyProjectAccess(
  projectId: string,
  userId: string,
  minimumRole: ProjectRole = "VIEWER"
): Promise<boolean> {
  const result = await getProjectAccess(projectId, userId, minimumRole);
  return result.hasAccess;
}

export async function canViewProject(projectId: string, userId: string): Promise<boolean> {
  return verifyProjectAccess(projectId, userId, "VIEWER");
}

export async function canEditProject(projectId: string, userId: string): Promise<boolean> {
  return verifyProjectAccess(projectId, userId, "MEMBER");
}

export async function canAdminProject(projectId: string, userId: string): Promise<boolean> {
  return verifyProjectAccess(projectId, userId, "ADMIN");
}

export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  return verifyProjectAccess(projectId, userId, "OWNER");
}
