export interface ImportPlaneArgs {
  user?: string;
  workspace: string;
  projectIdentifiers: string[];
  dryRun: boolean;
  emailMap: Record<string, string>;
}

function parseEmailMapping(value: string): [string, string] {
  const [from, to, ...rest] = value.split("=").map((part) => part.trim());
  if (!from || !to || rest.length > 0) throw new Error(`--map-email needs plane-email=opm-email, got "${value}"`);
  return [from, to];
}

export function parseImportPlaneArgs(argv: string[]): ImportPlaneArgs {
  let user: string | undefined;
  let workspace: string | undefined;
  let dryRun = false;
  const projectIdentifiers: string[] = [];
  const emailMap: Record<string, string> = {};

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
    else if (arg === "--map-email") {
      const [from, to] = parseEmailMapping(valueOf(arg, argv[++i]));
      emailMap[from] = to;
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!workspace) throw new Error("--workspace needs a Plane workspace slug");
  return { user, workspace, projectIdentifiers, dryRun, emailMap };
}
