export interface ImportPlaneArgs {
  user?: string;
  workspace: string;
  projectIdentifiers: string[];
  dryRun: boolean;
}

export function parseImportPlaneArgs(argv: string[]): ImportPlaneArgs {
  let user: string | undefined;
  let workspace: string | undefined;
  let dryRun = false;
  const projectIdentifiers: string[] = [];

  const valueOf = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.trim() === "") throw new Error(`${flag} needs a value`);
    return value.trim();
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--user") user = valueOf(arg, argv[++i]);
    else if (arg === "--workspace") workspace = valueOf(arg, argv[++i]);
    else if (arg === "--project") projectIdentifiers.push(valueOf(arg, argv[++i]));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!workspace) throw new Error("--workspace needs a Plane workspace slug");
  return { user, workspace, projectIdentifiers, dryRun };
}
