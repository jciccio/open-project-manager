import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { ImportInProgressError, runImportJob } from "../jobs";
import type { Importer, ImportSummary } from "../types";

function importerWithAFailingCard(): Importer {
  return {
    name: "fake",
    async *fetchProjects() {
      yield { sourceId: "proj-1", name: "Job Project" };
    },
    async *fetchColumns() {},
    async *fetchCardTypes() {},
    async *fetchLabels() {},
    async *fetchCards() {
      yield { sourceId: "card-1", columnSourceId: "missing-column", title: "Orphan" };
    },
    async *fetchComments() {},
  };
}

describe("runImportJob (the CLI path)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`import-jobs-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("is refused while another import holds the user's lock", async () => {
    const running = await db.importJob.create({ data: { userId, source: "fake", lockKey: userId } });
    await expect(runImportJob(importerWithAFailingCard(), userId)).rejects.toThrow(ImportInProgressError);
    await expect(runImportJob(importerWithAFailingCard(), userId)).rejects.toMatchObject({ jobId: running.id });
    expect(await db.project.count({ where: { userId } })).toBe(0);
  });

  it("returns the full summary to the caller but stores per-record errors redacted", async () => {
    const { jobId, summary } = await runImportJob(importerWithAFailingCard(), userId);
    const failed = (summary as ImportSummary).records.find((r) => r.status === "failed")!;
    expect(failed.error).toContain("missing-column");

    const job = await db.importJob.findUnique({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "DONE", lockKey: null });
    const stored = JSON.parse(job!.summaryJson!) as ImportSummary;
    expect(stored.records.find((r) => r.status === "failed")!.error).toBe(
      "Failed to import this record; see the server log."
    );
    expect(await db.importRecord.count({ where: { userId, importRunId: jobId } })).toBeGreaterThan(0);
  });
});
