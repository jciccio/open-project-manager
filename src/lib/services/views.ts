import { db } from "@/lib/db";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

// Serializable so two concurrent "make this the default" calls can't both
// clear the old default and both set theirs.
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
const CONCURRENT_CHANGE_ERROR = "Another change to this project's views happened at the same time. Try again.";

function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function getSavedViews(projectId: string, userId: string) {
  try {
    const hasAccess = await verifyProjectAccess(projectId, userId, "VIEWER");
    if (!hasAccess) return { success: false, error: "Project not found or access denied" };

    const savedViews = await db.savedView.findMany({
      where: { projectId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return { success: true, data: savedViews };
  } catch (error) {
    console.error("Error fetching saved views:", error);
    return { success: false, error: "Failed to fetch saved views" };
  }
}

export async function createSavedView(
  projectId: string,
  data: {
    name: string;
    filterJson?: string;
    isDefault?: boolean;
  },
  userId: string
) {
  try {
    if (!data.name || !data.name.trim()) {
      return { success: false, error: "View name is required" };
    }

    const hasAccess = await verifyProjectAccess(projectId, userId, "MEMBER");
    if (!hasAccess) return { success: false, error: "Project not found or access denied" };

    const savedView = await db.$transaction(async (tx) => {
      // If setting as default, unset other defaults in the project
      if (data.isDefault) {
        await tx.savedView.updateMany({
          where: { projectId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.savedView.create({
        data: {
          projectId,
          name: data.name.trim(),
          filterJson: data.filterJson || "{}",
          isDefault: !!data.isDefault,
        },
      });
    }, SERIALIZABLE);

    safeRevalidatePath(`/projects/${projectId}`);

    return { success: true, data: savedView };
  } catch (error) {
    if (isSerializationConflict(error)) return { success: false, error: CONCURRENT_CHANGE_ERROR };
    console.error("Error creating saved view:", error);
    return { success: false, error: "Failed to create saved view or name already exists" };
  }
}

export async function updateSavedView(
  id: string,
  data: {
    name?: string;
    filterJson?: string;
    isDefault?: boolean;
  },
  userId: string
) {
  try {
    const existing = await db.savedView.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || !(await verifyProjectAccess(existing.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Saved view not found or access denied" };
    }

    const savedView = await db.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.savedView.updateMany({
          where: { projectId: existing.projectId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.savedView.update({
        where: { id },
        data: {
          name: data.name !== undefined ? data.name.trim() : undefined,
          filterJson: data.filterJson !== undefined ? data.filterJson : undefined,
          isDefault: data.isDefault !== undefined ? data.isDefault : undefined,
        },
      });
    }, SERIALIZABLE);

    safeRevalidatePath(`/projects/${existing.projectId}`);

    return { success: true, data: savedView };
  } catch (error) {
    if (isSerializationConflict(error)) return { success: false, error: CONCURRENT_CHANGE_ERROR };
    console.error(`Error updating saved view ${id}:`, error);
    return { success: false, error: "Failed to update saved view" };
  }
}

export async function deleteSavedView(id: string, userId: string) {
  try {
    const existing = await db.savedView.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!existing || !(await verifyProjectAccess(existing.projectId, userId, "MEMBER"))) {
      return { success: false, error: "Saved view not found or access denied" };
    }

    await db.savedView.delete({
      where: { id },
    });

    safeRevalidatePath(`/projects/${existing.projectId}`);

    return { success: true, deletedId: id };
  } catch (error) {
    console.error(`Error deleting saved view ${id}:`, error);
    return { success: false, error: "Failed to delete saved view" };
  }
}
