export interface ImportVikunjaArgs {
  user?: string;
  projectIds: number[];
  dryRun: boolean;
}

export function parseImportVikunjaArgs(argv: string[]): ImportVikunjaArgs {
  const args: ImportVikunjaArgs = { projectIds: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--user") args.user = argv[++i];
    else if (arg === "--project") {
      const value = argv[++i];
      const projectId = Number(value);
      if (value === undefined || value.trim() === "" || !Number.isInteger(projectId) || projectId <= 0) {
        throw new Error(`--project needs a positive integer Vikunja project id, got ${value === undefined ? "nothing" : `"${value}"`}`);
      }
      args.projectIds.push(projectId);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}
