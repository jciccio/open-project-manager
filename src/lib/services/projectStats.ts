import { db } from "@/lib/db";

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  overdue: number;
  archived: number;
  percentComplete: number | null;
}

export const EMPTY_PROJECT_STATS: ProjectStats = {
  total: 0,
  done: 0,
  open: 0,
  overdue: 0,
  archived: 0,
  percentComplete: null,
};

export function startOfUtcToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getProjectStats(
  projectIds: string[],
  userId: string,
  now: Date = new Date()
): Promise<Record<string, ProjectStats>> {
  if (projectIds.length === 0) return {};

  const scope = {
    projectId: { in: projectIds },
    project: { OR: [{ userId }, { members: { some: { userId } } }] },
  };
  const countByProject = (where: object) =>
    db.card.groupBy({ by: ["projectId"], where: { ...scope, ...where }, _count: { _all: true } });

  const [total, done, overdue, archived] = await Promise.all([
    countByProject({ isArchived: false }),
    countByProject({ isArchived: false, column: { isDone: true } }),
    countByProject({
      isArchived: false,
      column: { isDone: false },
      dueDate: { lt: startOfUtcToday(now) },
    }),
    countByProject({ isArchived: true }),
  ]);

  const toMap = (rows: { projectId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.projectId, row._count._all]));
  const totals = toMap(total);
  const dones = toMap(done);
  const overdues = toMap(overdue);
  const archiveds = toMap(archived);

  const stats: Record<string, ProjectStats> = {};
  for (const id of projectIds) {
    const totalCount = totals.get(id) ?? 0;
    const doneCount = dones.get(id) ?? 0;
    stats[id] = {
      total: totalCount,
      done: doneCount,
      open: totalCount - doneCount,
      overdue: overdues.get(id) ?? 0,
      archived: archiveds.get(id) ?? 0,
      percentComplete: totalCount === 0 ? null : Math.round((doneCount / totalCount) * 100),
    };
  }
  return stats;
}
