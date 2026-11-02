/**
 * Dry-run a Plane workspace import against this instance's database.
 *
 *   PLANE_API_KEY=… \
 *   npx tsx scripts/import-plane.ts --workspace my-team --project ABC --user you@example.com --dry-run
 *
 * Set PLANE_URL for a self-hosted instance (default: https://api.plane.so).
 */
import { db } from "../src/lib/db";
import { ImportInProgressError, runImportJob } from "../src/lib/import/jobs";
import { PlaneImporter } from "../src/lib/import/plane";
import type { ImportDryRunSummary } from "../src/lib/import/types";
import { parseImportPlaneArgs, type ImportPlaneArgs } from "./import-plane-args";
import { resolveImportUserId } from "./resolve-import-user";

function parseArgs(argv: string[]): ImportPlaneArgs {
  try {
    return parseImportPlaneArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.PLANE_API_KEY;
  if (!apiKey) throw new Error("Set PLANE_API_KEY (see README: Importing an Existing Board)");
  const baseUrl = process.env.PLANE_URL || "https://api.plane.so";

  const userId = await resolveImportUserId(args.user);
  const importer = new PlaneImporter({
    baseUrl,
    apiKey,
    workspaceSlug: args.workspace,
    projectIdentifiers: args.projectIdentifiers,
  });

  console.log(
    `Dry run from ${baseUrl}, workspace ${args.workspace}` +
      (args.projectIdentifiers.length ? ` (projects ${args.projectIdentifiers.join(", ")})` : " (all visible projects)")
  );
  console.log("Plane's public API does not return archived work items, drafts or intake items, so they are not counted.");

  let summary: ImportDryRunSummary;
  try {
    ({ summary } = (await runImportJob(importer, userId, { dryRun: true })) as { summary: ImportDryRunSummary });
  } catch (err) {
    if (err instanceof ImportInProgressError) {
      console.error(`${err.message} Wait for it to finish (GET /api/v1/import/<jobId>), then run this again.`);
      process.exit(1);
    }
    throw err;
  }

  const { wouldCreate, wouldSkip, wouldFail } = summary.totals;
  console.log(`\nWould create ${wouldCreate}, would skip ${wouldSkip}, would fail ${wouldFail} (nothing was written).`);
  for (const record of summary.records.filter((r) => r.status === "would_fail")) {
    console.error(`  WOULD FAIL ${record.entityType} ${record.sourceId}: ${record.error}`);
  }

  const byType = new Map<string, number>();
  for (const record of summary.records) byType.set(record.entityType, (byType.get(record.entityType) || 0) + 1);
  console.log([...byType].map(([type, count]) => `${type}: ${count}`).join("  "));
}

main()
  .catch((err) => {
    console.error(`\nDry run failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
