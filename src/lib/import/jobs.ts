import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { runImport } from "./runImport";
import type { Importer, ImportDryRunSummary, ImportSummary, RunImportOptions } from "./types";

export const HEARTBEAT_INTERVAL_MS = 30_000;
// A live job refreshes its heartbeat every HEARTBEAT_INTERVAL_MS, so one that
// has been silent this long belongs to a process that died (e.g. a restart).
export const STALE_JOB_MS = 5 * 60_000;

export const IMPORT_FAILED_MESSAGE = "Import failed; see the server log.";

export class ImportInProgressError extends Error {
  readonly stoppedResponding: boolean;

  constructor(readonly jobId: string | undefined, heartbeatAt?: Date) {
    const job = jobId ? ` (job ${jobId})` : "";
    const silentMs = heartbeatAt ? Date.now() - heartbeatAt.getTime() : 0;
    const stoppedResponding = silentMs > 2 * HEARTBEAT_INTERVAL_MS;
    super(
      stoppedResponding
        ? `An import is registered for this account${job}, but it last reported ${Math.round(silentMs / 1000)} seconds ago, ` +
            `so it may have stopped. Its lock is released, and a new run allowed, at ` +
            `${new Date(heartbeatAt!.getTime() + STALE_JOB_MS).toISOString()}.`
        : `An import is already running for this account${job}.`
    );
    this.stoppedResponding = stoppedResponding;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function createRunningJob(userId: string, source: string, dryRun: boolean) {
  return db.importJob.create({ data: { userId, source, dryRun, lockKey: userId } });
}

/** Takes the user's import lock by creating a RUNNING job, releasing a lock whose job stopped responding. */
async function acquireJob(userId: string, source: string, dryRun: boolean) {
  try {
    return await createRunningJob(userId, source, dryRun);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const holder = await db.importJob.findUnique({ where: { lockKey: userId } });
  if (holder && Date.now() - holder.heartbeatAt.getTime() < STALE_JOB_MS) {
    throw new ImportInProgressError(holder.id, holder.heartbeatAt);
  }
  if (holder) {
    await db.importJob.updateMany({
      where: { id: holder.id, lockKey: userId },
      data: { status: "FAILED", lockKey: null, error: "The import stopped responding.", finishedAt: new Date() },
    });
  }

  try {
    return await createRunningJob(userId, source, dryRun);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.importJob.findUnique({ where: { lockKey: userId }, select: { id: true } });
    throw new ImportInProgressError(winner?.id);
  }
}

function redactFailures(summary: ImportSummary | ImportDryRunSummary): ImportSummary | ImportDryRunSummary {
  if (summary.mode !== "live") return summary;
  return {
    ...summary,
    records: summary.records.map((record) =>
      record.status === "failed" ? { ...record, error: "Failed to import this record; see the server log." } : record
    ),
  };
}

async function runJob(
  jobId: string,
  importer: Importer,
  userId: string,
  dryRun: boolean,
  onProgress?: RunImportOptions["onProgress"]
) {
  const heartbeat = setInterval(() => {
    db.importJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const summary = await runImport(importer, userId, { dryRun, importRunId: jobId, onProgress });
    if (summary.mode === "live" && !onProgress) {
      for (const record of summary.records.filter((r) => r.status === "failed")) {
        console.error(`Import ${jobId} ${record.entityType} ${record.sourceId} failed:`, record.error);
      }
    }
    await db.importJob.update({
      where: { id: jobId },
      data: { status: "DONE", lockKey: null, summaryJson: JSON.stringify(redactFailures(summary)), finishedAt: new Date() },
    });
    return summary;
  } catch (error) {
    console.error(`Import ${jobId} failed:`, error);
    await db.importJob.update({
      where: { id: jobId },
      data: { status: "FAILED", lockKey: null, error: IMPORT_FAILED_MESSAGE, finishedAt: new Date() },
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Starts an import in the background. Throws ImportInProgressError when the user
 * already has one running. `done` settles when the job has recorded its outcome.
 */
export async function startImportJob(
  importer: Importer,
  userId: string,
  options: { dryRun?: boolean } = {}
): Promise<{ jobId: string; done: Promise<void> }> {
  const dryRun = options.dryRun === true;
  const job = await acquireJob(userId, importer.name, dryRun);
  const done = runJob(job.id, importer, userId, dryRun).then(
    () => undefined,
    (error) => console.error(`Import ${job.id} ended with an error:`, error)
  );
  return { jobId: job.id, done };
}

/** Runs an import under the same per-user lock and waits for it, returning the unredacted summary. */
export async function runImportJob(
  importer: Importer,
  userId: string,
  options: Pick<RunImportOptions, "dryRun" | "onProgress"> = {}
) {
  const dryRun = options.dryRun === true;
  const job = await acquireJob(userId, importer.name, dryRun);
  return { jobId: job.id, summary: await runJob(job.id, importer, userId, dryRun, options.onProgress) };
}

export async function getImportJob(jobId: string, userId: string) {
  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== userId) return null;
  return {
    id: job.id,
    source: job.source,
    dryRun: job.dryRun,
    status: job.status,
    summary: job.summaryJson ? JSON.parse(job.summaryJson) : null,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}
