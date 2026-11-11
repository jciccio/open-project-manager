/**
 * Import a Plane workspace into this instance's database.
 *
 *   PLANE_API_KEY=… \
 *   npx tsx scripts/import-plane.ts --workspace my-team --project ABC --user you@example.com --dry-run
 *
 * Leave out --dry-run to write. Set PLANE_URL for a self-hosted instance (default: https://api.plane.so).
 */
import { db } from "../src/lib/db";
import { ImportInProgressError, runImportJob } from "../src/lib/import/jobs";
import { PlaneImporter } from "../src/lib/import/plane";
import { findExistingMapping } from "../src/lib/import/runImport";
import type { ImportDroppedField, ImportDryRunSummary, ImportProject, ImportSummary } from "../src/lib/import/types";
import { parseImportPlaneArgs, type ImportPlaneArgs } from "./import-plane-args";
import { projectKeyProblems } from "./import-plane-preflight";
import { resolveImportUserId } from "./resolve-import-user";

function parseArgs(argv: string[]): ImportPlaneArgs {
  try {
    return parseImportPlaneArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

async function findKeyProblems(importer: PlaneImporter, userId: string): Promise<string[]> {
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

function printRecordCounts(records: Array<{ entityType: string }>) {
  const byType = new Map<string, number>();
  for (const record of records) byType.set(record.entityType, (byType.get(record.entityType) || 0) + 1);
  console.log([...byType].map(([type, count]) => `${type}: ${count}`).join("  "));
}

function printDropped(dropped: ImportDroppedField[]) {
  if (dropped.length === 0) return;
  console.log("Not carried over:");
  for (const { field, count } of dropped) console.log(`  ${field}: ${count}`);
}

function printDryRun(summary: ImportDryRunSummary, importer: PlaneImporter) {
  const { wouldCreate, wouldSkip, wouldFail } = summary.totals;
  console.log(`\nWould create ${wouldCreate}, would skip ${wouldSkip}, would fail ${wouldFail} (nothing was written).`);
  for (const record of summary.records.filter((r) => r.status === "would_fail")) {
    console.error(`  WOULD FAIL ${record.entityType} ${record.sourceId}: ${record.error}`);
  }
  printRecordCounts(summary.records);
  printDropped(summary.dropped);
  if (importer.crossProjectRelationsSkipped > 0) {
    console.log(`Not checked: ${importer.crossProjectRelationsSkipped} relation sides pointing at another project.`);
  }
}

function printLive(summary: ImportSummary) {
  const { created, skipped, failed } = summary.totals;
  console.log(`\nCreated ${created}, skipped ${skipped}, failed ${failed}.`);
  for (const record of summary.records.filter((r) => r.status === "failed")) {
    console.error(`  FAILED ${record.entityType} ${record.sourceId}: ${record.error}`);
  }
  printRecordCounts(summary.records);
  printDropped(summary.dropped);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.PLANE_API_KEY;
  if (!apiKey) throw new Error("Set PLANE_API_KEY (see README: Importing an Existing Board)");
  const baseUrl = process.env.PLANE_URL || "https://api.plane.so";

  const userId = await resolveImportUserId(args.user);
  const importer: PlaneImporter = new PlaneImporter({
    baseUrl,
    apiKey,
    workspaceSlug: args.workspace,
    projectIdentifiers: args.projectIdentifiers,
    skipCrossProjectRelations: args.dryRun,
    isCardImported: async (cardSourceId) => !!(await findExistingMapping(userId, importer.name, "card", cardSourceId)),
    emailMap: args.emailMap,
  });

  console.log(
    `${args.dryRun ? "Dry run" : "Import"} from ${baseUrl}, workspace ${args.workspace}` +
      (args.projectIdentifiers.length ? ` (projects ${args.projectIdentifiers.join(", ")})` : " (all visible projects)")
  );
  console.log("Plane's public API does not return archived work items, drafts or intake items, so they are not included.");

  const keyProblems = await findKeyProblems(importer, userId);
  for (const problem of keyProblems) console.error(`  KEY ${problem}`);
  if (keyProblems.length > 0 && !args.dryRun) {
    console.error("\nNothing was imported. Fix these project keys, then run this again.");
    process.exitCode = 1;
    return;
  }

  try {
    const { summary } = await runImportJob(importer, userId, { dryRun: args.dryRun });
    if (summary.mode === "dry-run") printDryRun(summary, importer);
    else printLive(summary);
  } catch (err) {
    if (err instanceof ImportInProgressError) {
      console.error(`${err.message} Wait for it to finish (GET /api/v1/import/<jobId>), then run this again.`);
      process.exit(1);
    }
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(`\nImport failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
