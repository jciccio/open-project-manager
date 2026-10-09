import { db } from "@/lib/db";

export async function lastColumnError(projectId: string): Promise<string | null> {
  const columnCount = await db.column.count({ where: { projectId } });
  return columnCount <= 1 ? "A project needs at least one column. Add another column before deleting this one." : null;
}
