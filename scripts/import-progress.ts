import type { ImportProgressEvent } from "../src/lib/import/types";
import { ImportInProgressError } from "../src/lib/import/jobs";

export function formatImportProgress(event: ImportProgressEvent, dryRun: boolean): string {
  switch (event.kind) {
    case "project":
      return `${event.project}: starting`;
    case "cardsRead":
      return `${event.project}: read ${event.count} work items`;
    case "cardsProcessed":
      return `${event.project}: ${event.count}/${event.total} cards processed`;
    case "failed": {
      const { entityType, sourceId, error } = event.record;
      return `  ${dryRun ? "WOULD FAIL" : "FAILED"} ${entityType} ${sourceId}: ${error}`;
    }
  }
}

export function printImportProgress(dryRun: boolean) {
  return (event: ImportProgressEvent) => {
    const line = formatImportProgress(event, dryRun);
    if (event.kind === "failed") console.error(line);
    else console.log(line);
  };
}

export function importInProgressMessage(err: ImportInProgressError): string {
  return err.stoppedResponding
    ? err.message
    : `${err.message} Wait for it to finish (GET /api/v1/import/<jobId>), then run this again.`;
}
