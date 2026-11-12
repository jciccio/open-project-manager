import { db } from "../src/lib/db";
import type { Importer, ImportProject } from "../src/lib/import/types";
import { MAX_PROJECT_KEY_LENGTH, sanitizeProjectKey } from "../src/lib/projectKey";

export interface PreflightProject {
  sourceId: string;
  key?: string;
}

/**
 * `generateProjectKey` keeps only A-Z and 0-9, cuts a key to 12 characters and adds a suffix
 * when one is taken. Each would change `ABC-123` references without any error, so a live
 * import refuses first.
 */
export function projectKeyProblems(
  projects: PreflightProject[],
  existingKeys: ReadonlySet<string>,
  alreadyImportedSourceIds: ReadonlySet<string>
): string[] {
  const problems: string[] = [];
  for (const project of projects) {
    if (alreadyImportedSourceIds.has(project.sourceId) || !project.key) continue;
    const key = project.key.toUpperCase();
    if (key.length > MAX_PROJECT_KEY_LENGTH) {
      problems.push(`${key}: OPM keys are limited to ${MAX_PROJECT_KEY_LENGTH} characters, so this project's references would break.`);
    } else if (sanitizeProjectKey(key) !== key) {
      problems.push(`${key}: OPM keys hold only letters A-Z and digits, so this project's references would break.`);
    } else if (existingKeys.has(key)) {
      problems.push(`${key}: this account already has a project with that key, so the import would rename it and break its references.`);
    }
  }
  return problems;
}

export async function findKeyProblems(importer: Pick<Importer, "name" | "fetchProjects">, userId: string): Promise<string[]> {
  const projects: ImportProject[] = [];
  for await (const project of importer.fetchProjects()) projects.push(project);

  const existing = await db.project.findMany({ where: { userId }, select: { id: true, key: true } });
  const records = await db.importRecord.findMany({
    where: { userId, source: importer.name, entityType: "project" },
    select: { sourceId: true, localId: true },
  });
  const existingIds = new Set(existing.map((project) => project.id));
  return projectKeyProblems(
    projects,
    new Set(existing.map((project) => project.key)),
    new Set(records.filter((record) => existingIds.has(record.localId)).map((record) => record.sourceId))
  );
}
