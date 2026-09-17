/**
 * Import a Vikunja board straight into this instance's database.
 *
 * Runs on the machine that owns the database (no OPM API token needed) — the
 * server-side counterpart to `POST /api/v1/import`. Same adapter, same
 * ImportRecord idempotency, so re-running is safe.
 *
 *   VIKUNJA_URL=http://localhost:3456/api/v1 \
 *   VIKUNJA_API_TOKEN=… \
 *   npx tsx scripts/import-vikunja.ts --user jose@example.com --project 2 --dry-run
 */
import { db } from "../src/lib/db";
import { runImport } from "../src/lib/import/runImport";
import { VikunjaImporter } from "../src/lib/import/vikunja";
import type { ImportSummary, ImportDryRunSummary } from "../src/lib/import/types";

interface Args {
  user?: string;
  projectIds: number[];
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { projectIds: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--user") args.user = argv[++i];
    else if (arg === "--project") args.projectIds.push(Number(argv[++i]));
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

async function resolveUserId(identifier?: string): Promise<string> {
  if (identifier) {
    const user = await db.user.findFirst({
      where: { OR: [{ id: identifier }, { email: identifier }] },
      select: { id: true, email: true },
    });
    if (!user) throw new Error(`No user matches "${identifier}" (pass an email or a user id)`);
    console.log(`Importing as ${user.email}`);
    return user.id;
  }

  const users = await db.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length === 0) throw new Error("This instance has no users — create one in the web UI first");
  if (users.length > 1) {
    throw new Error("More than one user on this instance — say which one owns the import with --user <email>");
  }
  console.log(`Importing as ${users[0].email}`);
  return users[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baseUrl = process.env.VIKUNJA_URL;
  const token = process.env.VIKUNJA_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("Set VIKUNJA_URL and VIKUNJA_API_TOKEN (see README: Importing an Existing Board)");
  }

  const userId = await resolveUserId(args.user);
  const importer = new VikunjaImporter({ baseUrl, token, projectIds: args.projectIds });

  console.log(
    `${args.dryRun ? "Dry run" : "Importing"} from ${baseUrl}` +
      (args.projectIds.length ? ` (projects ${args.projectIds.join(", ")})` : " (all visible projects)")
  );

  const summary = await runImport(importer, userId, { dryRun: args.dryRun });

  if (summary.mode === "dry-run") {
    const { wouldCreate, wouldSkip } = (summary as ImportDryRunSummary).totals;
    console.log(`\nWould create ${wouldCreate}, would skip ${wouldSkip} (nothing was written).`);
  } else {
    const live = summary as ImportSummary;
    console.log(`\nCreated ${live.totals.created}, skipped ${live.totals.skipped}, failed ${live.totals.failed}.`);
    for (const record of live.records.filter((r) => r.status === "failed")) {
      console.error(`  FAILED ${record.entityType} ${record.sourceId}: ${record.error}`);
    }
  }

  // Per-entity counts make it obvious when, say, comments silently came back empty.
  const byType = new Map<string, number>();
  for (const record of summary.records) byType.set(record.entityType, (byType.get(record.entityType) || 0) + 1);
  console.log([...byType].map(([type, count]) => `${type}: ${count}`).join("  "));
}

main()
  .catch((err) => {
    console.error(`\nImport failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
