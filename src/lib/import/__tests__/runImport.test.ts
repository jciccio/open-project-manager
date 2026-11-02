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

  it("dry run reports a card whose column would not be imported as would_fail, matching the live run", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"].push({
      sourceId: "card-bad",
      columnSourceId: "col-does-not-exist",
      title: "Orphaned card",
    });
    const importer = makeFakeImporter(fixture);

    const dryRun = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;
    const badDryRecord = dryRun.records.find((r) => r.sourceId === "card-bad");
    expect(badDryRecord?.status).toBe("would_fail");
    expect(badDryRecord?.error).toMatch(/Unknown columnSourceId "col-does-not-exist"/);
    expect(dryRun.totals.wouldFail).toBe(1);

    const live = (await runImport(importer, userId)) as ImportSummary;
    expect(live.totals.failed).toBe(dryRun.totals.wouldFail);
  });

  describe("a source label shared by two projects", () => {
    function twoProjectFixture(): FakeData {
      return {
        projects: [
          { sourceId: "proj-a", name: "Project A" },
          { sourceId: "proj-b", name: "Project B" },
        ],
        columns: {
          "proj-a": [{ sourceId: "col-a", name: "To Do" }],
          "proj-b": [{ sourceId: "col-b", name: "To Do" }],
        },
        cardTypes: {},
        labels: {
          "proj-a": [{ sourceId: "label-shared", name: "Shared" }],
          "proj-b": [{ sourceId: "label-shared", name: "Shared" }],
        },
        cards: {
          "proj-a": [{ sourceId: "card-a", columnSourceId: "col-a", title: "Card A", labelSourceIds: ["label-shared"] }],
          "proj-b": [{ sourceId: "card-b", columnSourceId: "col-b", title: "Card B", labelSourceIds: ["label-shared"] }],
        },
        comments: {},
      };
    }

    async function cardLabelProjectId(title: string) {
      const card = await db.card.findFirst({
        where: { title, project: { userId } },
        include: { labels: { include: { label: true } } },
      });
      return { card: card!, labelProjectIds: card!.labels.map((l) => l.label.projectId) };
    }

    it("creates one label per project and points each project's cards at its own label", async () => {
      await runImport(makeFakeImporter(twoProjectFixture()), userId);

      const projectA = await db.project.findFirst({ where: { userId, name: "Project A" } });
      const projectB = await db.project.findFirst({ where: { userId, name: "Project B" } });
      expect(await db.label.count({ where: { projectId: projectA!.id } })).toBe(1);
      expect(await db.label.count({ where: { projectId: projectB!.id } })).toBe(1);

      expect((await cardLabelProjectId("Card A")).labelProjectIds).toEqual([projectA!.id]);
      expect((await cardLabelProjectId("Card B")).labelProjectIds).toEqual([projectB!.id]);
    });

    it("keeps the second project's card labels when the first project is deleted", async () => {
      await runImport(makeFakeImporter(twoProjectFixture()), userId);

      const projectA = await db.project.findFirst({ where: { userId, name: "Project A" } });
      await db.project.delete({ where: { id: projectA!.id } });

      expect((await cardLabelProjectId("Card B")).labelProjectIds.length).toBe(1);
    });

    it("is idempotent on re-run and the dry run agrees", async () => {
      const importer = makeFakeImporter(twoProjectFixture());
      await runImport(importer, userId);

      const dryRun = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;
      expect(dryRun.totals.wouldCreate).toBe(0);

      const second = (await runImport(importer, userId)) as ImportSummary;
      expect(second.totals.created).toBe(0);
      expect(await db.label.count({ where: { project: { userId } } })).toBe(2);
    });

    it("reuses a mapping recorded before labels were keyed per project, but only within its own project", async () => {
      const importer = makeFakeImporter(twoProjectFixture());
      await runImport(importer, userId);
      const projectA = await db.project.findFirst({ where: { userId, name: "Project A" } });
      const labelA = await db.label.findFirst({ where: { projectId: projectA!.id } });
      const projectB = await db.project.findFirst({ where: { userId, name: "Project B" } });

      await db.importRecord.deleteMany({ where: { userId, entityType: "label" } });
      await db.label.deleteMany({ where: { projectId: projectB!.id } });
      await db.importRecord.create({
        data: { userId, source: "fake", entityType: "label", sourceId: "label-shared", localId: labelA!.id, importRunId: "pre-fix" },
      });

      const dryRun = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;
      expect(dryRun.records.filter((r) => r.entityType === "label").map((r) => r.status)).toEqual([
        "would_skip",
        "would_create",
      ]);

      const rerun = (await runImport(importer, userId)) as ImportSummary;
      const labelResults = rerun.records.filter((r) => r.entityType === "label");
      expect(labelResults.map((r) => r.status)).toEqual(["skipped", "created"]);
      expect(labelResults[0].localId).toBe(labelA!.id);
      expect(await db.label.count({ where: { projectId: projectA!.id } })).toBe(1);
      expect(await db.label.count({ where: { projectId: projectB!.id } })).toBe(1);
    });
  });

  it("catches iteration errors in child entities and records them as failures without aborting the run", async () => {
    const importer: Importer = {
      name: "faulty",
      async *fetchProjects() {
        yield { sourceId: "p-error", name: "Faulty Project" };
        yield { sourceId: "p-healthy", name: "Healthy Project" };
      },
      async *fetchColumns(projectSourceId) {
        if (projectSourceId === "p-error") {
          throw new Error("Simulated adapter 500 error fetching columns");
        }
        yield { sourceId: "col-ok", name: "Backlog" };
      },
      async *fetchCardTypes() {},
      async *fetchLabels() {},
      async *fetchCards() {},
      async *fetchComments() {},
    };

    const summary = (await runImport(importer, userId)) as ImportSummary;
    expect(summary.totals.failed).toBe(1);
    const failedRecord = summary.records.find((r) => r.status === "failed");
    expect(failedRecord?.error).toMatch(/Simulated adapter 500/);

    const healthyProject = summary.records.find((r) => r.sourceId === "p-healthy" && r.status === "created");
    expect(healthyProject).toBeDefined();
    const healthyColumn = summary.records.find((r) => r.sourceId === "col-ok" && r.status === "created");
    expect(healthyColumn).toBeDefined();
  });

  it("reuses a card type that already exists in the project under the same name", async () => {
    const withoutTypes = { ...baseFixture(), cardTypes: {}, cards: {}, comments: {} };
    await runImport(makeFakeImporter(withoutTypes), userId);
    const project = await db.project.findFirst({ where: { userId, name: "Imported Project" } });
    const handMade = await db.cardType.create({ data: { projectId: project!.id, name: "Task" } });

    const withTypes = makeFakeImporter({
      ...withoutTypes,
      cardTypes: {
        "proj-1": [
          { sourceId: "type-task", name: "Task" },
          { sourceId: "type-bug", name: "Bug" },
        ],
      },
    });

    const dryRun = (await runImport(withTypes, userId, { dryRun: true })) as ImportDryRunSummary;
    expect(dryRun.records.filter((r) => r.entityType === "cardType").map((r) => [r.sourceId, r.status])).toEqual([
      ["type-task", "would_skip"],
      ["type-bug", "would_create"],
    ]);

    const live = (await runImport(withTypes, userId)) as ImportSummary;
    const typeResults = live.records.filter((r) => r.entityType === "cardType");
    expect(typeResults.map((r) => [r.sourceId, r.status])).toEqual([
      ["type-task", "skipped"],
      ["type-bug", "created"],
    ]);
    expect(typeResults[0].localId).toBe(handMade.id);
    expect(live.totals.failed).toBe(0);
    expect(await db.cardType.count({ where: { projectId: project!.id } })).toBe(2);

    const again = (await runImport(withTypes, userId)) as ImportSummary;
    expect(again.totals.created).toBe(0);
  });

  it("two concurrent runs that both find a new card create it once", async () => {
    await runImport(makeFakeImporter(baseFixture()), userId);
    const withNewCard = baseFixture();
    withNewCard.cards["proj-1"].push({ sourceId: "card-3", columnSourceId: "col-todo", title: "Added later" });

    const [first, second] = (await Promise.all([
      runImport(makeFakeImporter(withNewCard), userId),
      runImport(makeFakeImporter(withNewCard), userId),
    ])) as ImportSummary[];

    expect([...first.records, ...second.records].filter((r) => r.status === "failed")).toEqual([]);
    expect(await db.card.count({ where: { project: { userId }, title: "Added later" } })).toBe(1);
    expect(await db.importRecord.count({ where: { userId, entityType: "card", sourceId: "card-3" } })).toBe(1);
  });

  it("preserves authoritative card numbers and increments subsequent cards correctly", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      { sourceId: "c-109", columnSourceId: "col-todo", title: "Authoritative 109", number: 109 },
      { sourceId: "c-auto", columnSourceId: "col-todo", title: "Next Auto Number" },
      { sourceId: "c-42", columnSourceId: "col-todo", title: "Authoritative 42", number: 42 },
      { sourceId: "c-auto-2", columnSourceId: "col-todo", title: "Next Auto Number After 109" },
    ];

    const summary = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(summary.totals.failed).toBe(0);

    const card109 = await db.card.findFirst({ where: { project: { userId }, title: "Authoritative 109" } });
    expect(card109?.number).toBe(109);

    const cardAuto = await db.card.findFirst({ where: { project: { userId }, title: "Next Auto Number" } });
    expect(cardAuto?.number).toBe(110);

    const card42 = await db.card.findFirst({ where: { project: { userId }, title: "Authoritative 42" } });
    expect(card42?.number).toBe(42);

    const cardAuto2 = await db.card.findFirst({ where: { project: { userId }, title: "Next Auto Number After 109" } });
    expect(cardAuto2?.number).toBe(111);
  });

  it("preserves parent-child hierarchy, relations, links, archived state and creation timestamps", async () => {
    const fixture = baseFixture();
    const createdDate = "2023-04-12T10:30:00.000Z";
    fixture.cards["proj-1"] = [
      {
        sourceId: "child-card",
        columnSourceId: "col-todo",
        title: "Child Card",
        parentSourceId: "parent-card",
        relations: [{ targetCardSourceId: "parent-card", type: "BLOCKS" }],
        links: [{ url: "https://developers.plane.so", title: "Plane API Docs" }],
        isArchived: true,
        createdAt: createdDate,
      },
      {
        sourceId: "parent-card",
        columnSourceId: "col-todo",
        title: "Parent Card",
      },
    ];

    const summary = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(summary.totals.failed).toBe(0);

    const parent = await db.card.findFirst({ where: { project: { userId }, title: "Parent Card" } });
    const child = await db.card.findFirst({
      where: { project: { userId }, title: "Child Card" },
      include: { links: true, outgoingRelations: true },
    });

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentId).toBe(parent?.id);
    expect(child?.isArchived).toBe(true);
    expect(child?.createdAt.toISOString()).toBe(createdDate);

    // Links check
    expect(child?.links.length).toBe(1);
    expect(child?.links[0].url).toBe("https://developers.plane.so");
    expect(child?.links[0].title).toBe("Plane API Docs");

    // Relations check
    expect(child?.outgoingRelations.length).toBe(1);
    expect(child?.outgoingRelations[0].targetCardId).toBe(parent?.id);
    expect(child?.outgoingRelations[0].type).toBe("BLOCKS");
  });

  it("preserves column group, color, and description", async () => {
    const fixture = baseFixture();
    fixture.columns["proj-1"] = [
      {
        sourceId: "col-cancelled",
        name: "Cancelled",
        group: "CANCELLED",
        color: "#94a3b8",
        description: "Abandoned tasks",
      },
    ];
    fixture.cards["proj-1"] = [];

    const summary = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(summary.totals.failed).toBe(0);

    const column = await db.column.findFirst({ where: { project: { userId }, name: "Cancelled" } });
    expect(column?.group).toBe("CANCELLED");
    expect(column?.color).toBe("#94a3b8");
    expect(column?.description).toBe("Abandoned tasks");
  });

  it("reports failure in dry-run and live-run when card references an unknown labelSourceId", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-bad-label",
        columnSourceId: "col-todo",
        title: "Card with missing label",
        labelSourceIds: ["non-existent-label-id"],
      },
    ];

    // Dry-run check
    const dryRun = (await runImport(makeFakeImporter(fixture), userId, { dryRun: true })) as ImportDryRunSummary;
    const dryCard = dryRun.records.find((r) => r.sourceId === "card-bad-label");
    expect(dryCard?.status).toBe("would_fail");
    expect(dryCard?.error).toContain('Unknown labelSourceId "non-existent-label-id"');

    // Live run check
    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const liveCard = live.records.find((r) => r.sourceId === "card-bad-label");
    expect(liveCard?.status).toBe("failed");
    expect(liveCard?.error).toContain('Unknown labelSourceId "non-existent-label-id"');
  });

  it("validates parent hierarchy with validateParentCard and rejects 3-level chains", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      { sourceId: "epic", columnSourceId: "col-todo", title: "Epic" },
      { sourceId: "story", columnSourceId: "col-todo", title: "Story", parentSourceId: "epic" },
      { sourceId: "subtask", columnSourceId: "col-todo", title: "Subtask", parentSourceId: "story" },
    ];

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const parentFailures = live.records.filter((r) => r.status === "failed" && r.sourceId.endsWith(":parent"));
    expect(parentFailures.length).toBe(1);
    expect(parentFailures[0].error).toMatch(/Subtasks cannot be nested under another subtask|A card with subtasks cannot be made a subtask/);

    const epic = await db.card.findFirst({ where: { project: { userId }, title: "Epic" } });
    const story = await db.card.findFirst({ where: { project: { userId }, title: "Story" } });
    const subtask = await db.card.findFirst({ where: { project: { userId }, title: "Subtask" } });

    expect(epic).toBeDefined();
    expect(story).toBeDefined();
    expect(subtask).toBeDefined();

    // 3-level chain is prevented
    if (story?.parentId === epic?.id) {
      expect(subtask?.parentId).toBeNull();
    } else {
      expect(subtask?.parentId).toBe(story?.id);
      expect(story?.parentId).toBeNull();
    }
  });

  it("records failure when parent or relation target is unresolved", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-orphan",
        columnSourceId: "col-todo",
        title: "Card with missing parent and relation",
        parentSourceId: "missing-parent",
        relations: [{ targetCardSourceId: "missing-relation-target", type: "BLOCKS" }],
      },
    ];

    const dryRun = (await runImport(makeFakeImporter(fixture), userId, { dryRun: true })) as ImportDryRunSummary;
    expect(dryRun.records.some((r) => r.sourceId === "card-orphan:parent" && r.status === "would_fail")).toBe(true);
    expect(dryRun.records.some((r) => r.sourceId === "card-orphan:relation:missing-relation-target" && r.status === "would_fail")).toBe(true);

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(live.records.some((r) => r.sourceId === "card-orphan:parent" && r.status === "failed")).toBe(true);
    expect(live.records.some((r) => r.sourceId === "card-orphan:relation:missing-relation-target" && r.status === "failed")).toBe(true);
  });

  it("validates column group and enforces isDone agreement with resolveColumnGroup", async () => {
    const fixture = baseFixture();
    fixture.columns["proj-1"] = [
      { sourceId: "col-bad-group", name: "Bad Group", group: "BOGUS" },
      { sourceId: "col-conflict", name: "Conflict", group: "COMPLETED", isDone: false },
    ];
    fixture.cards["proj-1"] = [];

    const dryRun = (await runImport(makeFakeImporter(fixture), userId, { dryRun: true })) as ImportDryRunSummary;
    const badDry = dryRun.records.find((r) => r.sourceId === "col-bad-group");
    const conflictDry = dryRun.records.find((r) => r.sourceId === "col-conflict");
    expect(badDry?.status).toBe("would_fail");
    expect(badDry?.error).toContain('Invalid column group "BOGUS"');
    expect(conflictDry?.status).toBe("would_fail");
    expect(conflictDry?.error).toContain("isDone must be true exactly when group is COMPLETED");

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const badLive = live.records.find((r) => r.sourceId === "col-bad-group");
    const conflictLive = live.records.find((r) => r.sourceId === "col-conflict");
    expect(badLive?.status).toBe("failed");
    expect(conflictLive?.status).toBe("failed");
  });

  it("avoids number collision when auto-numbered card precedes explicit number: 1", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      { sourceId: "card-auto-first", columnSourceId: "col-todo", title: "Auto First" },
      { sourceId: "card-explicit-one", columnSourceId: "col-todo", title: "Explicit One", number: 1 },
    ];

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(live.totals.failed).toBe(0);

    const autoCard = await db.card.findFirst({ where: { project: { userId }, title: "Auto First" } });
    const explicitCard = await db.card.findFirst({ where: { project: { userId }, title: "Explicit One" } });

    expect(explicitCard?.number).toBe(1);
    expect(autoCard?.number).toBe(2);
  });

  it("falls back to auto-numbering and annotates description when explicit card number already exists in project", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      { sourceId: "card-initial", columnSourceId: "col-todo", title: "Initial Card", number: 1 },
    ];

    await runImport(makeFakeImporter(fixture), userId);

    // Second import with a new card attempting to reuse number 1
    const fixture2 = baseFixture();
    fixture2.cards["proj-1"] = [
      {
        sourceId: "card-duplicate-number",
        columnSourceId: "col-todo",
        title: "Colliding Card",
        description: "Existing details",
        number: 1,
      },
    ];

    const live2 = (await runImport(makeFakeImporter(fixture2), userId)) as ImportSummary;
    const cardRecord = live2.records.find((r) => r.sourceId === "card-duplicate-number");
    expect(cardRecord?.status).toBe("created");

    const createdCard = await db.card.findFirst({
      where: { project: { userId }, title: "Colliding Card" },
    });
    expect(createdCard).not.toBeNull();
    expect(createdCard?.number).toBe(2);
    expect(createdCard?.description).toBe("Existing details\n\n[Original card index: 1]");
  });

  it("imports partially fetched cards when fetchCards throws mid-stream", async () => {
    const fixture = baseFixture();
    const importer: Importer = {
      ...makeFakeImporter(fixture),
      async *fetchCards() {
        yield { sourceId: "card-partial-1", columnSourceId: "col-todo", title: "Partial 1" };
        yield { sourceId: "card-partial-2", columnSourceId: "col-todo", title: "Partial 2" };
        throw new Error("Mid-stream 500 error from source");
      },
    };

    const live = (await runImport(importer, userId)) as ImportSummary;
    expect(live.records.find((r) => r.sourceId === "proj-1:cards")?.status).toBe("failed");
    expect(live.records.find((r) => r.sourceId === "card-partial-1")?.status).toBe("created");
    expect(live.records.find((r) => r.sourceId === "card-partial-2")?.status).toBe("created");

    const cardsInDb = await db.card.findMany({ where: { project: { userId } } });
    expect(cardsInDb.map((c) => c.title)).toContain("Partial 1");
    expect(cardsInDb.map((c) => c.title)).toContain("Partial 2");
  });

  it("rejects unsafe link URLs like javascript: and records failure in live and dry run", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-bad-link",
        columnSourceId: "col-todo",
        title: "Bad Link Card",
        links: [{ url: "javascript:alert(1)" }],
      },
    ];

    const dry = (await runImport(makeFakeImporter(fixture), userId, { dryRun: true })) as ImportDryRunSummary;
    const dryRec = dry.records.find((r) => r.sourceId === "card-bad-link");
    expect(dryRec?.status).toBe("would_fail");
    expect(dryRec?.error).toContain("Invalid link URL");

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const liveRec = live.records.find((r) => r.sourceId === "card-bad-link");
    expect(liveRec?.status).toBe("failed");
    expect(liveRec?.error).toContain("Invalid link URL");
  });

  it("rejects self-relations and invalid relation types", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-self-rel",
        columnSourceId: "col-todo",
        title: "Self Rel Card",
        relations: [{ targetCardSourceId: "card-self-rel", type: "BLOCKS" }],
      },
      {
        sourceId: "card-target",
        columnSourceId: "col-todo",
        title: "Target Card",
      },
      {
        sourceId: "card-invalid-rel",
        columnSourceId: "col-todo",
        title: "Invalid Rel Card",
        relations: [{ targetCardSourceId: "card-target", type: "INVALID_TYPE" as any }],
      },
    ];

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const selfRelRec = live.records.find((r) => r.sourceId === "card-self-rel:relation:card-self-rel");
    expect(selfRelRec?.status).toBe("failed");
    expect(selfRelRec?.error).toContain("A card cannot relate to itself");

    const invalidRelRec = live.records.find((r) => r.sourceId === "card-invalid-rel:relation:card-target");
    expect(invalidRelRec?.status).toBe("failed");
    expect(invalidRelRec?.error).toContain("Invalid relation type");
  });

  it("canonicalizes inverse relations preventing duplicate rows", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-a",
        columnSourceId: "col-todo",
        title: "Card A",
        relations: [{ targetCardSourceId: "card-b", type: "BLOCKS" }],
      },
      {
        sourceId: "card-b",
        columnSourceId: "col-todo",
        title: "Card B",
        relations: [{ targetCardSourceId: "card-a", type: "BLOCKED_BY" }],
      },
    ];

    const live = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    expect(live.totals.created).toBeGreaterThanOrEqual(2);

    const relCount = await db.cardRelation.count();
    expect(relCount).toBe(1);
  });

  it("allows already-mapped cards to skip cleanly even if label is not fetched", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      {
        sourceId: "card-labelled",
        columnSourceId: "col-todo",
        title: "Labelled Card",
        labelSourceIds: ["label-urgent"],
      },
    ];

    await runImport(makeFakeImporter(fixture), userId);

    // Second run where fetchLabels fails / yields empty
    const fixture2 = baseFixture();
    fixture2.labels["proj-1"] = [];
    fixture2.cards["proj-1"] = [
      {
        sourceId: "card-labelled",
        columnSourceId: "col-todo",
        title: "Labelled Card",
        labelSourceIds: ["label-urgent"],
      },
    ];

    const live2 = (await runImport(makeFakeImporter(fixture2), userId)) as ImportSummary;
    const cardRec = live2.records.find((r) => r.sourceId === "card-labelled");
    expect(cardRec?.status).toBe("skipped");
  });

  it("does not re-update parents or relations for skipped cards on re-import", async () => {
    const fixture = baseFixture();
    fixture.cards["proj-1"] = [
      { sourceId: "parent-card", columnSourceId: "col-todo", title: "Parent" },
      {
        sourceId: "child-card",
        columnSourceId: "col-todo",
        title: "Child",
        parentSourceId: "parent-card",
      },
    ];

    await runImport(makeFakeImporter(fixture), userId);

    const childInDb = await db.card.findFirst({ where: { project: { userId }, title: "Child" } });
    expect(childInDb?.parentId).not.toBeNull();

    // User manually un-parents the card in OPM UI
    await db.card.update({ where: { id: childInDb!.id }, data: { parentId: null } });

    // Re-run import
    const live2 = (await runImport(makeFakeImporter(fixture), userId)) as ImportSummary;
    const childRec = live2.records.find((r) => r.sourceId === "child-card");
    expect(childRec?.status).toBe("skipped");

    // ParentId should still be null (not overwritten!)
    const childAfterReimport = await db.card.findUnique({ where: { id: childInDb!.id } });
    expect(childAfterReimport?.parentId).toBeNull();
  });
});
