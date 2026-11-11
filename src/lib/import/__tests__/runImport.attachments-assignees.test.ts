import fs from "fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getAttachmentFilePath, MAX_ATTACHMENT_BYTES, UPLOADS_DIR } from "@/lib/attachmentStorage";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { runImport } from "../runImport";
import type { ImportAssignee, ImportAttachment, ImportCard, Importer, ImportDryRunSummary, ImportSummary } from "../types";

const PROJECT = "proj-1";
const COLUMN = "col-1";
const CARD = "card-1";

function fakeImporter(options: {
  card?: Partial<ImportCard>;
  attachments?: ImportAttachment[] | (() => AsyncGenerator<ImportAttachment>);
  labelDescription?: string;
  dropped?: Importer["droppedFields"];
}): Importer {
  const { card, attachments = [], labelDescription, dropped } = options;
  return {
    name: "fake",
    async *fetchProjects() {
      yield { sourceId: PROJECT, name: "Imported" };
    },
    async *fetchColumns() {
      yield { sourceId: COLUMN, name: "To Do" };
    },
    async *fetchCardTypes() {},
    async *fetchLabels() {
      yield { sourceId: "label-1", name: "bug", description: labelDescription };
    },
    async *fetchCards() {
      yield { sourceId: CARD, columnSourceId: COLUMN, title: "Card", ...card };
    },
    async *fetchComments() {},
    async *fetchAttachments() {
      if (typeof attachments === "function") yield* attachments();
      else yield* attachments;
    },
    droppedFields: dropped,
  };
}

function attachment(overrides: Partial<ImportAttachment> = {}): ImportAttachment {
  return {
    sourceId: "att-1",
    filename: "shot one.png",
    mimeType: "image/png",
    size: 3,
    uploadedBy: "ada",
    createdAt: "2020-01-01T00:00:00.000Z",
    download: vi.fn(async () => Buffer.from("abc")),
    ...overrides,
  };
}

const UNMATCHED_FIELD = "Assignees with no matching OPM account (names kept in the card owner)";

describe("runImport attachments and assignees", () => {
  let userId: string;
  let email: string;
  const extraUsers: string[] = [];

  beforeEach(async () => {
    const res = await createTestUser(`import-extras-${Date.now()}`);
    userId = res.user.id;
    email = res.user.email;
  });

  afterEach(async () => {
    const attachments = await db.attachment.findMany({
      where: { card: { project: { userId } } },
      select: { storageKey: true },
    });
    for (const { storageKey } of attachments) fs.rmSync(getAttachmentFilePath(storageKey), { force: true });
    await cleanupTestUser(userId);
    for (const id of extraUsers.splice(0)) await cleanupTestUser(id);
  });

  async function importedCard() {
    return db.card.findFirstOrThrow({
      where: { project: { userId } },
      include: { attachments: true, assignees: true },
    });
  }

  function statusOf(summary: ImportSummary, sourceId: string) {
    return summary.records.find((record) => record.sourceId === sourceId)?.status;
  }

  async function storedFiles() {
    return fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];
  }

  describe("attachments", () => {
    it("stores the file and the row, keeping the source's metadata", async () => {
      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;

      expect(statusOf(summary, "att-1")).toBe("created");
      const [row] = (await importedCard()).attachments;
      expect(row).toMatchObject({
        filename: "shot one.png",
        size: 3,
        mimeType: "image/png",
        uploadedBy: "ada",
        url: `/api/v1/attachments/${row.id}`,
      });
      expect(row.createdAt.toISOString()).toBe("2020-01-01T00:00:00.000Z");
      expect(row.storageKey).toMatch(/shot_one\.png$/);
      expect(fs.readFileSync(getAttachmentFilePath(row.storageKey)).toString()).toBe("abc");
    });

    it("skips an imported attachment on a re-run without downloading it again", async () => {
      const first = attachment();
      await runImport(fakeImporter({ attachments: [first] }), userId);
      const second = attachment();

      const summary = (await runImport(fakeImporter({ attachments: [second] }), userId)) as ImportSummary;

      expect(statusOf(summary, "att-1")).toBe("skipped");
      expect(second.download).not.toHaveBeenCalled();
      expect((await importedCard()).attachments).toHaveLength(1);
    });

    it("adds a new attachment to a card that was already imported", async () => {
      await runImport(fakeImporter({ attachments: [] }), userId);

      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;

      expect(statusOf(summary, CARD)).toBe("skipped");
      expect(statusOf(summary, "att-1")).toBe("created");
    });

    it("records a failed download against the attachment, keeps the card and retries on a re-run", async () => {
      const failing = attachment({ download: vi.fn(async () => Promise.reject(new Error("storage down"))) });

      const first = (await runImport(fakeImporter({ attachments: [failing] }), userId)) as ImportSummary;

      expect(statusOf(first, CARD)).toBe("created");
      expect(first.records.find((r) => r.sourceId === "att-1")).toMatchObject({ status: "failed", error: "storage down" });

      const second = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;
      expect(statusOf(second, "att-1")).toBe("created");
    });

    it("refuses a file the source reports as too large without downloading it", async () => {
      const large = attachment({ size: MAX_ATTACHMENT_BYTES + 1 });

      const summary = (await runImport(fakeImporter({ attachments: [large] }), userId)) as ImportSummary;

      expect(large.download).not.toHaveBeenCalled();
      expect(summary.records.find((r) => r.sourceId === "att-1")?.error).toContain("attachment size limit");
    });

    it("refuses a downloaded file that turns out too large and leaves no file behind", async () => {
      const before = await storedFiles();
      const large = attachment({ size: 3, download: vi.fn(async () => Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)) });

      const summary = (await runImport(fakeImporter({ attachments: [large] }), userId)) as ImportSummary;

      expect(summary.records.find((r) => r.sourceId === "att-1")?.status).toBe("failed");
      expect(await storedFiles()).toEqual(before);
    });

    it("removes the file when the database write fails", async () => {
      const before = await storedFiles();
      const transaction = vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("db down"));

      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;
      transaction.mockRestore();

      expect(summary.records.find((r) => r.sourceId === "att-1")).toMatchObject({ status: "failed", error: "db down" });
      expect(await storedFiles()).toEqual(before);
    });

    it("removes the row and the file when the import record can't be written", async () => {
      const before = await storedFiles();
      const original = db.importRecord.create;
      const create = vi.spyOn(db.importRecord, "create").mockImplementation(((args: { data: { entityType: string } }) =>
        args.data.entityType === "attachment"
          ? Promise.reject(new Error("record write failed"))
          : original(args as never)) as never);

      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;
      create.mockRestore();

      expect(statusOf(summary, "att-1")).toBe("failed");
      expect((await importedCard()).attachments).toEqual([]);
      expect(await storedFiles()).toEqual(before);
    });

    it("imports a deleted attachment again on a re-run", async () => {
      await runImport(fakeImporter({ attachments: [attachment()] }), userId);
      const [row] = (await importedCard()).attachments;
      await db.attachment.delete({ where: { id: row.id } });
      fs.rmSync(getAttachmentFilePath(row.storageKey), { force: true });

      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId)) as ImportSummary;

      expect(statusOf(summary, "att-1")).toBe("created");
    });

    it("records a failure when listing a card's attachments fails, and keeps the card", async () => {
      const importer = fakeImporter({
        attachments: async function* () {
          throw new Error("list failed");
        },
      });

      const summary = (await runImport(importer, userId)) as ImportSummary;

      expect(statusOf(summary, CARD)).toBe("created");
      expect(summary.records.find((r) => r.sourceId === `${CARD}:attachments`)).toMatchObject({
        entityType: "attachment",
        status: "failed",
        error: "list failed",
      });
    });

    it("works with an adapter that has no attachments", async () => {
      const importer = fakeImporter({});
      delete importer.fetchAttachments;

      const summary = (await runImport(importer, userId)) as ImportSummary;

      expect(summary.totals.failed).toBe(0);
    });

    it("a dry run lists attachments, flags oversized ones and downloads nothing", async () => {
      const small = attachment();
      const large = attachment({ sourceId: "att-2", size: MAX_ATTACHMENT_BYTES + 1 });

      const summary = (await runImport(fakeImporter({ attachments: [small, large] }), userId, {
        dryRun: true,
      })) as ImportDryRunSummary;

      expect(small.download).not.toHaveBeenCalled();
      expect(large.download).not.toHaveBeenCalled();
      expect(summary.records.find((r) => r.sourceId === "att-1")?.status).toBe("would_create");
      expect(summary.records.find((r) => r.sourceId === "att-2")?.status).toBe("would_fail");
      expect(await db.attachment.count({ where: { card: { project: { userId } } } })).toBe(0);
    });

    it("a dry run reports an imported attachment as a skip", async () => {
      await runImport(fakeImporter({ attachments: [attachment()] }), userId);

      const summary = (await runImport(fakeImporter({ attachments: [attachment()] }), userId, {
        dryRun: true,
      })) as ImportDryRunSummary;

      expect(summary.records.find((r) => r.sourceId === "att-1")?.status).toBe("would_skip");
    });

    it("a dry run records a failure when listing attachments fails", async () => {
      const importer = fakeImporter({
        attachments: async function* () {
          throw new Error("list failed");
        },
      });

      const summary = (await runImport(importer, userId, { dryRun: true })) as ImportDryRunSummary;

      expect(summary.records.find((r) => r.sourceId === `${CARD}:attachments`)?.status).toBe("would_fail");
    });
  });

  describe("assignees", () => {
    const withAssignees = (assignees: ImportAssignee[]) => fakeImporter({ card: { assignees } });

    it("assigns the project's owner by email, ignoring case", async () => {
      const summary = (await runImport(withAssignees([{ email: email.toUpperCase(), name: "Me" }]), userId)) as ImportSummary;

      const card = await importedCard();
      expect(card.assignees.map((a) => a.userId)).toEqual([userId]);
      expect(card.owner).toBeNull();
      expect(summary.dropped).toEqual([]);
    });

    it("assigns one person once when they appear twice", async () => {
      await runImport(withAssignees([{ email }, { email: email.toUpperCase() }]), userId);

      expect((await importedCard()).assignees).toHaveLength(1);
    });

    it("assigns an existing project member on a card added by a later run", async () => {
      await runImport(fakeImporter({}), userId);
      const member = await createTestUser(`import-member-${Date.now()}`);
      extraUsers.push(member.user.id);
      const project = await db.project.findFirstOrThrow({ where: { userId } });
      await db.projectMember.create({ data: { projectId: project.id, userId: member.user.id } });
      await db.card.deleteMany({ where: { projectId: project.id } });

      await runImport(withAssignees([{ email: member.user.email }]), userId);

      expect((await importedCard()).assignees.map((a) => a.userId)).toEqual([member.user.id]);
    });

    it("does not assign or add a user who exists but isn't on the project", async () => {
      const outsider = await createTestUser(`import-outsider-${Date.now()}`);
      extraUsers.push(outsider.user.id);

      const summary = (await runImport(
        withAssignees([{ email: outsider.user.email, name: "Outsider" }]),
        userId
      )) as ImportSummary;

      const card = await importedCard();
      expect(card.assignees).toEqual([]);
      expect(card.owner).toBe("Outsider");
      expect(await db.projectMember.count({ where: { userId: outsider.user.id } })).toBe(0);
      expect(summary.dropped).toEqual([{ field: UNMATCHED_FIELD, count: 1 }]);
    });

    it("adds unmatched names to an owner the card already has", async () => {
      await runImport(
        fakeImporter({ card: { owner: "Lead", assignees: [{ name: "Ada" }, { email: "gone@example.test", name: "Grace" }] } }),
        userId
      );

      expect((await importedCard()).owner).toBe("Lead, Ada, Grace");
    });

    it("does not count assignees again when a re-run skips the card", async () => {
      const importer = () => withAssignees([{ name: "Ada" }]);
      await runImport(importer(), userId);

      const summary = (await runImport(importer(), userId)) as ImportSummary;

      expect(summary.dropped).toEqual([]);
    });

    it("a dry run counts unmatched assignees on new cards only", async () => {
      const importer = () => withAssignees([{ email, name: "Me" }, { name: "Ada" }]);

      const first = (await runImport(importer(), userId, { dryRun: true })) as ImportDryRunSummary;
      expect(first.dropped).toEqual([{ field: UNMATCHED_FIELD, count: 1 }]);

      await runImport(importer(), userId);
      const second = (await runImport(importer(), userId, { dryRun: true })) as ImportDryRunSummary;
      expect(second.dropped).toEqual([]);
    });
  });

  it("stores a label's description", async () => {
    await runImport(fakeImporter({ labelDescription: "Broken things" }), userId);

    const label = await db.label.findFirstOrThrow({ where: { project: { userId } } });
    expect(label.description).toBe("Broken things");
  });

  it("includes the adapter's dropped fields in both summaries", async () => {
    const dropped = () => [{ field: "Cycles", count: 2 }];

    const dry = (await runImport(fakeImporter({ dropped }), userId, { dryRun: true })) as ImportDryRunSummary;
    const live = (await runImport(fakeImporter({ dropped }), userId)) as ImportSummary;

    expect(dry.dropped).toEqual([{ field: "Cycles", count: 2 }]);
    expect(live.dropped).toEqual([{ field: "Cycles", count: 2 }]);
  });
});
