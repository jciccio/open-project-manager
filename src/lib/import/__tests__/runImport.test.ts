import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { runImport } from "../runImport";
import type {
  Importer,
  ImportProject,
  ImportColumn,
  ImportCardType,
  ImportLabel,
  ImportCard,
  ImportComment,
  ImportSummary,
  ImportDryRunSummary,
} from "../types";

interface FakeData {
  projects: ImportProject[];
  columns: Record<string, ImportColumn[]>;
  cardTypes: Record<string, ImportCardType[]>;
  labels: Record<string, ImportLabel[]>;
  cards: Record<string, ImportCard[]>;
  comments: Record<string, ImportComment[]>;
}

function makeFakeImporter(data: FakeData): Importer {
  return {
    name: "fake",
    async *fetchProjects() {
      for (const p of data.projects) yield p;
    },
    async *fetchColumns(projectSourceId) {
      for (const c of data.columns[projectSourceId] || []) yield c;
    },
    async *fetchCardTypes(projectSourceId) {
      for (const c of data.cardTypes[projectSourceId] || []) yield c;
    },
    async *fetchLabels(projectSourceId) {
      for (const l of data.labels[projectSourceId] || []) yield l;
    },
    async *fetchCards(projectSourceId) {
      for (const c of data.cards[projectSourceId] || []) yield c;
    },
    async *fetchComments(cardSourceId) {
      for (const c of data.comments[cardSourceId] || []) yield c;
    },
  };
}

function baseFixture(): FakeData {
  return {
    projects: [{ sourceId: "proj-1", name: "Imported Project", description: "from fake source" }],
    columns: {
      "proj-1": [
        { sourceId: "col-todo", name: "To Do" },
        { sourceId: "col-done", name: "Done", isDone: true },
      ],
    },
    cardTypes: { "proj-1": [{ sourceId: "type-bug", name: "Bug" }] },
    labels: { "proj-1": [{ sourceId: "label-urgent", name: "Urgent" }] },
    cards: {
      "proj-1": [
        {
          sourceId: "card-1",
          columnSourceId: "col-todo",
          title: "First imported card",
          priority: "HIGH",
          typeSourceId: "type-bug",
          labelSourceIds: ["label-urgent"],
        },
        { sourceId: "card-2", columnSourceId: "col-done", title: "Second imported card" },
      ],
    },
    comments: {
      "card-1": [{ sourceId: "comment-1", author: "Original Author", content: "Migrated comment", createdAt: "2020-01-01T00:00:00.000Z" }],
    },
  };
}

describe("runImport", () => {
  let userId: string;

  beforeEach(async () => {
    const res = await createTestUser(`import-user-${Date.now()}`);
    userId = res.user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("imports a full project graph and records mappings for every entity", async () => {
    const importer = makeFakeImporter(baseFixture());
    const summary = (await runImport(importer, userId)) as ImportSummary;

    expect(summary.mode).toBe("live");
    expect(summary.totals.failed).toBe(0);
    expect(summary.totals.skipped).toBe(0);
    // 1 project + 2 columns + 1 cardType + 1 label + 2 cards + 1 comment
    expect(summary.totals.created).toBe(8);
    expect(summary.records.length).toBe(8);

    const project = await db.project.findFirst({ where: { userId, name: "Imported Project" } });
    expect(project).toBeTruthy();
    expect(project!.description).toBe("from fake source");

    const columns = await db.column.findMany({ where: { projectId: project!.id } });
    expect(columns.length).toBe(2);

    const cards = await db.card.findMany({ where: { projectId: project!.id }, include: { labels: true, type: true } });
    expect(cards.length).toBe(2);
    const card1 = cards.find((c) => c.title === "First imported card")!;
    expect(card1.priority).toBe("HIGH");
    expect(card1.type?.name).toBe("Bug");
    expect(card1.labels.length).toBe(1);
    expect(card1.number).not.toBe(0);

    const comments = await db.comment.findMany({ where: { cardId: card1.id } });
    expect(comments.length).toBe(1);
    expect(comments[0].author).toBe("Original Author");
    expect(comments[0].createdAt.toISOString()).toBe("2020-01-01T00:00:00.000Z");

    const mappings = await db.importRecord.findMany({ where: { userId, source: "fake" } });
    expect(mappings.length).toBe(summary.records.length);
  });

  it("preserves the source's completion timestamp on finished cards", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"][1].completedAt = "2021-06-05T12:00:00.000Z";
    await runImport(makeFakeImporter(fixture), userId);

    const card = await db.card.findFirst({ where: { title: "Second imported card" } });
    expect(card!.completedAt?.toISOString()).toBe("2021-06-05T12:00:00.000Z");

    const openCard = await db.card.findFirst({ where: { title: "First imported card" } });
    expect(openCard!.completedAt).toBeNull();
  });

  it("does not fire webhooks or write Activity rows during import", async () => {
    const importer = makeFakeImporter(baseFixture());
    await runImport(importer, userId);

    const project = await db.project.findFirst({ where: { userId } });
    const activities = await db.activity.findMany({ where: { card: { projectId: project!.id } } });
    expect(activities.length).toBe(0);
  });

  it("is idempotent on re-run: second run skips everything and creates no duplicates", async () => {
    const importer = makeFakeImporter(baseFixture());
    const first = (await runImport(importer, userId)) as ImportSummary;
    const second = (await runImport(importer, userId)) as ImportSummary;

    expect(second.totals.created).toBe(0);
    expect(second.totals.failed).toBe(0);
    expect(second.totals.skipped).toBe(first.totals.created);

    const projects = await db.project.findMany({ where: { userId } });
    expect(projects.length).toBe(1);
    const cards = await db.card.findMany({ where: { projectId: projects[0].id } });
    expect(cards.length).toBe(2);
  });

  it("recreates a record whose mapped local row was deleted out from under it", async () => {
    const importer = makeFakeImporter(baseFixture());
    await runImport(importer, userId);

    const project = await db.project.findFirst({ where: { userId } });
    await db.project.delete({ where: { id: project!.id } });

    // The ImportRecord mapping survives the cascade (it only FKs to User).
    const staleMapping = await db.importRecord.findFirst({ where: { userId, entityType: "project" } });
    expect(staleMapping).toBeTruthy();

    const rerun = (await runImport(importer, userId)) as ImportSummary;
    const projectResult = rerun.records.find((r) => r.entityType === "project");
    expect(projectResult?.status).toBe("created");

    const recreated = await db.project.findFirst({ where: { userId } });
    expect(recreated).toBeTruthy();
  });

  it("reports a failed record for a card referencing an unknown column, without aborting the rest of the import", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"].push({
      sourceId: "card-bad",
      columnSourceId: "col-does-not-exist",
      title: "Orphaned card",
    });
    const importer = makeFakeImporter(fixture);
    const summary = (await runImport(importer, userId)) as ImportSummary;

    const badCardResult = summary.records.find((r) => r.sourceId === "card-bad");
    expect(badCardResult?.status).toBe("failed");
    expect(badCardResult?.error).toMatch(/Unknown columnSourceId/);

    const project = await db.project.findFirst({ where: { userId } });
    const cards = await db.card.findMany({ where: { projectId: project!.id } });
    expect(cards.length).toBe(2); // the two well-formed cards still imported
  });

  it("dry run reports would-create counts without writing anything to the database", async () => {
    const importer = makeFakeImporter(baseFixture());
    const summary = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;

    expect(summary.mode).toBe("dry-run");
    expect(summary.totals.wouldCreate).toBeGreaterThan(0);
    expect(summary.totals.wouldSkip).toBe(0);

    const projectCount = await db.project.count({ where: { userId } });
    expect(projectCount).toBe(0);
  });

  it("dry run after a real run reports would-skip for already-imported records", async () => {
    const importer = makeFakeImporter(baseFixture());
    await runImport(importer, userId);
    const summary = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;

    expect(summary.totals.wouldCreate).toBe(0);
    expect(summary.totals.wouldSkip).toBeGreaterThan(0);
  });
});
