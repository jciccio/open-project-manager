import { describe, it, expect } from "vitest";
import { ImportInProgressError, HEARTBEAT_INTERVAL_MS } from "../../src/lib/import/jobs";
import { formatImportProgress, importInProgressMessage } from "../import-progress";

describe("formatImportProgress", () => {
  it("formats project and card count lines", () => {
    expect(formatImportProgress({ kind: "project", project: "ABC" }, false)).toBe("ABC: starting");
    expect(formatImportProgress({ kind: "cardsRead", project: "ABC", count: 300 }, false)).toBe(
      "ABC: read 300 work items"
    );
    expect(formatImportProgress({ kind: "cardsProcessed", project: "ABC", count: 450, total: 1973 }, false)).toBe(
      "ABC: 450/1973 cards processed"
    );
  });

  it("labels a failed record by run mode", () => {
    const event = {
      kind: "failed" as const,
      record: { entityType: "card" as const, sourceId: "c-1", status: "failed" as const, error: "boom" },
    };
    expect(formatImportProgress(event, false)).toBe("  FAILED card c-1: boom");
    expect(formatImportProgress(event, true)).toBe("  WOULD FAIL card c-1: boom");
  });
});

describe("importInProgressMessage", () => {
  it("tells the user to wait while the holder is still reporting", () => {
    const err = new ImportInProgressError("job-1", new Date());
    expect(importInProgressMessage(err)).toBe(
      "An import is already running for this account (job job-1). Wait for it to finish (GET /api/v1/import/<jobId>), then run this again."
    );
  });

  it("drops the wait advice once the holder has stopped reporting", () => {
    const err = new ImportInProgressError("job-1", new Date(Date.now() - 3 * HEARTBEAT_INTERVAL_MS));
    expect(importInProgressMessage(err)).toBe(err.message);
    expect(err.message).toContain("may have stopped");
  });
});
