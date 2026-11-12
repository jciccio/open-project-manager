import fs from "fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getAttachmentFilePath, MAX_ATTACHMENT_BYTES } from "@/lib/attachmentStorage";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { runImport } from "../runImport";
import type { ImportAttachment, ImportCard, Importer, ImportDryRunSummary, ImportSummary } from "../types";

const LIVE_STATUS = { would_create: "created", would_skip: "skipped", would_fail: "failed" } as const;

interface Fixture {
  cards: Record<string, ImportCard[]>;
  attachments: Record<string, Array<Omit<ImportAttachment, "download">>>;
}

function fixture(): Fixture {
  return {
    cards: {
      "proj-a": [
        { sourceId: "epic", columnSourceId: "col-a1", title: "Epic", assignees: [{ name: "Nobody", email: "nobody@example.invalid" }] },
        { sourceId: "story", columnSourceId: "col-a1", title: "Story", parentSourceId: "epic" },
        { sourceId: "sub", columnSourceId: "col-a1", title: "Nested subtask", parentSourceId: "story" },
        { sourceId: "self-parent", columnSourceId: "col-a1", title: "Own parent", parentSourceId: "self-parent" },
        { sourceId: "self-rel", columnSourceId: "col-a1", title: "Relates to itself", relations: [{ targetCardSourceId: "self-rel", type: "RELATES_TO" }] },
        { sourceId: "bad-link", columnSourceId: "col-a1", title: "Bad link", links: [{ url: "javascript:alert(1)" }] },
        { sourceId: "bad-label", columnSourceId: "col-a1", title: "Bad label", labelSourceIds: ["missing-label"] },
        { sourceId: "bad-column", columnSourceId: "col-a2", title: "In the rejected column" },
        { sourceId: "with-files", columnSourceId: "col-a1", title: "Has files", labelSourceIds: ["lab-a"] },
        { sourceId: "blocker", columnSourceId: "col-a1", title: "Blocks a card in B", relations: [{ targetCardSourceId: "b-card", type: "BLOCKS" }] },
      ],
      "proj-b": [
        { sourceId: "b-card", columnSourceId: "col-b1", title: "Blocked from A", relations: [{ targetCardSourceId: "blocker", type: "BLOCKED_BY" }] },
        { sourceId: "b-foreign-child", columnSourceId: "col-b1", title: "Parent in another project", parentSourceId: "epic" },
      ],
    },
    attachments: {
      "with-files": [
        { sourceId: "att-ok", filename: "ok.txt", mimeType: "text/plain", size: 3 },
        { sourceId: "att-big", filename: "big.bin", size: MAX_ATTACHMENT_BYTES + 1 },
      ],
    },
  };
}

function importer(data: Fixture, download: () => Promise<Buffer>): Importer {
  return {
    name: "fake-equivalence",
    async *fetchProjects() {
      yield { sourceId: "proj-a", name: "Project A", key: "PA" };
      yield { sourceId: "proj-b", name: "Project B", key: "PB" };
    },
    async *fetchColumns(projectSourceId) {
      if (projectSourceId === "proj-a") {
        yield { sourceId: "col-a1", name: "To Do" };
        yield { sourceId: "col-a2", name: "Broken", group: "NOT_A_GROUP" };
      } else {
        yield { sourceId: "col-b1", name: "To Do" };
      }
    },
    async *fetchCardTypes(projectSourceId) {
      yield { sourceId: `${projectSourceId}/type-task`, name: "Task" };
    },
    async *fetchLabels(projectSourceId) {
      if (projectSourceId === "proj-a") yield { sourceId: "lab-a", name: "alpha" };
    },
    async *fetchCards(projectSourceId) {
      yield* data.cards[projectSourceId] ?? [];
    },
    async *fetchComments(cardSourceId) {
      if (cardSourceId === "epic") {
        yield { sourceId: "comment-1", author: "ada", content: "First" };
        yield { sourceId: "comment-1", author: "ada", content: "Same source id again" };
      }
    },
    async *fetchAttachments(cardSourceId) {
      for (const attachment of data.attachments[cardSourceId] ?? []) yield { ...attachment, download };
    },
  };
}

function liveShape(summary: ImportSummary | ImportDryRunSummary) {
  return summary.records.map((record) => ({
    entityType: record.entityType,
    sourceId: record.sourceId,
    status: summary.mode === "dry-run" ? LIVE_STATUS[record.status as keyof typeof LIVE_STATUS] : record.status,
    error: record.error,
  }));
}

describe("runImport dry run and live run agree", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`import-equivalence-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    const attachments = await db.attachment.findMany({ where: { card: { project: { userId } } }, select: { storageKey: true } });
    for (const { storageKey } of attachments) fs.rmSync(getAttachmentFilePath(storageKey), { force: true });
    await cleanupTestUser(userId);
  });

  async function snapshot() {
    const scope = { project: { userId } };
    return {
      projects: await db.project.count({ where: { userId } }),
      columns: await db.column.count({ where: scope }),
      cardTypes: await db.cardType.count({ where: scope }),
      labels: await db.label.count({ where: scope }),
      cards: await db.card.findMany({ where: scope, select: { id: true, parentId: true }, orderBy: { id: "asc" } }),
      comments: await db.comment.count({ where: { card: scope } }),
      attachments: await db.attachment.count({ where: { card: scope } }),
      relations: await db.cardRelation.count({ where: { sourceCard: scope } }),
      importRecords: await db.importRecord.findMany({ where: { userId }, select: { id: true, localId: true }, orderBy: { id: "asc" } }),
    };
  }

  async function compare(data: Fixture) {
    const before = await snapshot();
    const dryDownload = vi.fn(async () => Buffer.from("abc"));
    const dry = (await runImport(importer(data, dryDownload), userId, { dryRun: true })) as ImportDryRunSummary;
    expect(dryDownload).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    expect(JSON.stringify(dry)).not.toContain("planned:");

    const live = (await runImport(importer(data, async () => Buffer.from("abc")), userId)) as ImportSummary;
    expect(liveShape(dry)).toEqual(liveShape(live));
    expect(dry.dropped).toEqual(live.dropped);
    return live;
  }

  it("reports the same records, statuses and errors on an empty database", async () => {
    const live = await compare(fixture());

    const failures = live.records.filter((record) => record.status === "failed").map((record) => [record.sourceId, record.error]);
    expect(failures).toEqual(
      expect.arrayContaining([
        ["col-a2", expect.stringContaining('Invalid column group "NOT_A_GROUP"')],
        ["bad-column", expect.stringContaining('Unknown columnSourceId "col-a2"')],
        ["bad-link", expect.stringContaining('Invalid link URL "javascript:alert(1)"')],
        ["bad-label", expect.stringContaining('Unknown labelSourceId "missing-label"')],
        ["att-big", expect.stringContaining("attachment size limit")],
        ["self-parent:parent", expect.stringContaining("A card cannot be its own parent")],
        ["self-rel:relation:self-rel", "A card cannot relate to itself"],
        ["blocker:relation:b-card", expect.stringContaining('Unresolved relation target "b-card"')],
        ["b-foreign-child:parent", expect.stringContaining("Parent card not found in this project")],
      ])
    );
    expect(failures.filter(([sourceId]) => ["story:parent", "sub:parent"].includes(sourceId as string))).toHaveLength(1);
    expect(live.records.filter((record) => record.sourceId === "comment-1").map((record) => record.status)).toEqual(["created", "skipped"]);
  });

  it("reports the same records on a database that already holds an earlier import", async () => {
    await runImport(importer(fixture(), async () => Buffer.from("abc")), userId);

    const data = fixture();
    data.cards["proj-a"].push(
      { sourceId: "late-child", columnSourceId: "col-a1", title: "Child of an imported card", parentSourceId: "epic" },
      { sourceId: "late-nested", columnSourceId: "col-a1", title: "Child of an imported subtask", parentSourceId: "story" },
      { sourceId: "late-rel", columnSourceId: "col-a1", title: "Relates to an imported card", relations: [{ targetCardSourceId: "self-parent", type: "RELATES_TO" }] }
    );
    const removed = await db.importRecord.findFirstOrThrow({ where: { userId, entityType: "card", sourceId: "with-files" } });
    await db.card.delete({ where: { id: removed.localId } });

    const live = await compare(data);
    expect(live.records.find((record) => record.sourceId === "with-files")?.status).toBe("created");
    expect(live.records.find((record) => record.sourceId === "late-child")?.status).toBe("created");
  });
});
