export const MAX_PRESERVED_KEY_LENGTH = 6;

export interface PreflightProject {
  sourceId: string;
  key?: string;
}

/**
 * `generateProjectKey` cuts a key to 6 characters and adds a suffix when one is taken.
 * Either would change `ABC-123` references without any error, so a live import refuses first.
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
    if (key.length > MAX_PRESERVED_KEY_LENGTH) {
      problems.push(`${key}: OPM keys are limited to ${MAX_PRESERVED_KEY_LENGTH} characters, so this project's references would break.`);
    } else if (existingKeys.has(key)) {
      problems.push(`${key}: this account already has a project with that key, so the import would rename it and break its references.`);
    }
  }
  return problems;
}
