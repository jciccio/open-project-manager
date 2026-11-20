import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { runImport } from "../runImport";
import type { Importer, ImportCard, ImportDryRunSummary, ImportProgressEvent, ImportSummary } from "../types";

const FIRST_PROJECT_CARDS = 30;
const SECOND_PROJECT_CARDS = 3;
const FAILING_CARD = "one-card-3";

function cardsFor(projectSourceId: string, count: number): ImportCard[] {
  return Array.from({ length: count }, (_, index) => {
    const sourceId = `${projectSourceId}-card-${index + 1}`;
    return {
      sourceId,
      columnSourceId: sourceId === FAILING_CARD ? "missing-column" : `${projectSourceId}-col`,
      title: `Card ${index + 1}`,
    };
  });
}

function twoProjectImporter(): Importer {
  const projects = [
    { sourceId: "one", name: "First", key: "ONE", cards: FIRST_PROJECT_CARDS },
    { sourceId: "two", name: "Second", key: "TWO", cards: SECOND_PROJECT_CARDS },
  ];
  return {
    name: "fake-progress",
    async *fetchProjects() {
      for (const { sourceId, name, key } of projects) yield { sourceId, name, key };
    },
    async *fetchColumns(projectSourceId: string) {
      yield { sourceId: `${projectSourceId}-col`, name: "To Do" };
    },
    async *fetchCardTypes() {},
    async *fetchLabels() {},
    async *fetchCards(projectSourceId: string) {
      const project = projects.find((p) => p.sourceId === projectSourceId)!;
      yield* cardsFor(projectSourceId, project.cards);
    },
    async *fetchComments() {},
  };
}

function eventsOf<K extends ImportProgressEvent["kind"]>(events: ImportProgressEvent[], kind: K) {
  return events.filter((e): e is Extract<ImportProgressEvent, { kind: K }> => e.kind === kind);
}

describe("runImport progress reporting", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`import-progress-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it.each([
    ["live", false],
    ["dry", true],
  ])("reports projects, card counts and failures as they happen (%s run)", async (_, dryRun) => {
    const events: ImportProgressEvent[] = [];
    await runImport(twoProjectImporter(), userId, { dryRun, onProgress: (event) => events.push(event) });

    expect(eventsOf(events, "project").map((e) => e.project)).toEqual(["ONE", "TWO"]);
    expect(eventsOf(events, "cardsRead").map((e) => [e.project, e.count])).toEqual([
      ["ONE", 25],
      ["ONE", 30],
      ["TWO", 3],
    ]);
    expect(eventsOf(events, "cardsProcessed").map((e) => [e.project, e.count, e.total])).toEqual([
      ["ONE", 25, 30],
      ["ONE", 30, 30],
      ["TWO", 3, 3],
    ]);

    const failures = eventsOf(events, "failed");
    expect(failures.map((e) => e.record.sourceId)).toEqual([FAILING_CARD]);
    expect(failures[0].record.error).toContain("missing-column");

    const failureAt = events.findIndex((e) => e.kind === "failed");
    const secondProjectAt = events.findIndex((e) => e.kind === "project" && e.project === "TWO");
    expect(failureAt).toBeLessThan(secondProjectAt);
  });

  it("reports a project with no cards", async () => {
    const importer = twoProjectImporter();
    importer.fetchCards = async function* () {};
    const events: ImportProgressEvent[] = [];
    await runImport(importer, userId, { dryRun: true, onProgress: (event) => events.push(event) });

    expect(eventsOf(events, "cardsRead").map((e) => [e.project, e.count])).toEqual([
      ["ONE", 0],
      ["TWO", 0],
    ]);
  });

  it("ignores an onProgress callback that throws", async () => {
    const dry = (await runImport(twoProjectImporter(), userId, { dryRun: true })) as ImportDryRunSummary;

    const live = (await runImport(twoProjectImporter(), userId, {
      onProgress: () => {
        throw new Error("stdout closed");
      },
    })) as ImportSummary;

    expect(live.totals).toEqual({
      created: dry.totals.wouldCreate,
      skipped: dry.totals.wouldSkip,
      failed: dry.totals.wouldFail,
    });
    expect(live.totals.failed).toBe(1);
  });
});
