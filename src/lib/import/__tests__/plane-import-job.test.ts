import fs from "fs";
import { createServer, type IncomingHttpHeaders, type Server } from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { getAttachmentFilePath } from "@/lib/attachmentStorage";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { runImportJob } from "../jobs";
import { PlaneImporter } from "../plane";
import { findExistingMapping } from "../runImport";
import type { ImportDryRunSummary, ImportSummary } from "../types";

const API_ROOT = "/api/v1/workspaces/my-team";
const ATTACHMENT_BYTES = "hello";
const UNMATCHED_ASSIGNEES = "Assignees with no matching OPM account (names kept in the card owner)";
const NOT_YET_IMPORTED = "Relation sides into a project not imported yet (imported with that project)";

function page(results: unknown[]) {
  return { results, next_cursor: null, next_page_results: false };
}

function states(prefix: string) {
  return [
    { id: `${prefix}-backlog`, name: "Backlog", group: "backlog", sequence: 1000 },
    { id: `${prefix}-todo`, name: "Todo", group: "unstarted", sequence: 2000 },
    { id: `${prefix}-doing`, name: "In Progress", group: "started", sequence: 3000, color: "#f59e0b" },
    { id: `${prefix}-done`, name: "Done", group: "completed", sequence: 4000 },
    { id: `${prefix}-cancelled`, name: "Cancelled", group: "cancelled", sequence: 5000 },
  ];
}

function planeWorkspace(storageUrl: string, importingEmail: string) {
  const items: Record<string, Array<Record<string, unknown>>> = {
    pa: [
      { id: "a1", name: "Parent", sequence_id: 1, state: "pa-doing", priority: "high", labels: ["la-bug"], assignees: ["u1"], description_html: "<p>Top <strong>level</strong></p>", created_at: "2024-01-02T00:00:00Z" },
      { id: "a2", name: "Child", sequence_id: 2, state: "pa-todo", parent: "a1" },
      { id: "a3", name: "Has a link", sequence_id: 3, state: "pa-backlog", assignees: ["u2"], labels: ["la-ui"] },
      { id: "a4", name: "Has a file", sequence_id: 4, state: "pa-done", completed_at: "2024-02-01T00:00:00Z" },
      { id: "a5", name: "Blocks the other project", sequence_id: 5, state: "pa-backlog" },
    ],
    pb: [{ id: "b1", name: "Blocked from alpha", sequence_id: 7, state: "pb-todo" }],
  };
  const routes: Record<string, () => { status: number; body?: unknown; headers?: Record<string, string> }> = {
    [`${API_ROOT}/projects/`]: () => ({
      status: 200,
      body: page([
        { id: "pa", name: "Alpha", identifier: "ALPHA", description: "First" },
        { id: "pb", name: "Beta", identifier: "BETA" },
      ]),
    }),
    [`${API_ROOT}/members/`]: () => ({
      status: 200,
      body: [
        { id: "u1", display_name: "ada", email: importingEmail.toUpperCase() },
        { id: "u2", first_name: "Grace", last_name: "Hopper" },
      ],
    }),
  };
  const labels: Record<string, unknown[]> = {
    pa: [
      { id: "la-bug", name: "bug", color: "#ef4444", description: "Something is broken" },
      { id: "la-ui", name: "ui" },
    ],
    pb: [{ id: "lb-ops", name: "ops" }],
  };
  for (const projectId of ["pa", "pb"]) {
    const base = `${API_ROOT}/projects/${projectId}`;
    routes[`${base}/states/`] = () => ({ status: 200, body: page(states(projectId)) });
    routes[`${base}/labels/`] = () => ({ status: 200, body: page(labels[projectId]) });
    routes[`${base}/estimates/`] = () => ({ status: 404, body: { error: "Estimate not found" } });
    routes[`${base}/cycles/`] = () => ({ status: 200, body: page([]) });
    routes[`${base}/modules/`] = () => ({ status: 200, body: page([]) });
    routes[`${base}/work-items/`] = () => ({ status: 200, body: page(items[projectId]) });
    for (const item of items[projectId]) {
      const itemBase = `${base}/work-items/${item.id}`;
      routes[`${itemBase}/links/`] = () => ({
        status: 200,
        body: page(item.id === "a3" ? [{ url: "https://example.com/spec", title: "Spec" }] : []),
      });
      routes[`${itemBase}/relations/`] = () => ({
        status: 200,
        body:
          item.id === "a5"
            ? { blocking: [{ project_id: "pb", issue_id: "b1" }] }
            : item.id === "b1"
              ? { blocked_by: [{ project_id: "pa", issue_id: "a5" }] }
              : {},
      });
      routes[`${itemBase}/comments/`] = () => ({
        status: 200,
        body: page(
          item.id === "a1"
            ? [
                { id: "c1", comment_html: "<p>First</p>", actor: "u1", created_at: "2024-01-03T00:00:00Z" },
                { id: "c2", comment_html: "<p>Second</p>", actor: "u2", created_at: "2024-01-04T00:00:00Z" },
              ]
            : []
        ),
      });
      routes[`${itemBase}/attachments/`] = () => ({
        status: 200,
        body:
          item.id === "a4"
            ? [{ id: "f1", attributes: { name: "notes.txt", type: "text/plain", size: ATTACHMENT_BYTES.length }, created_by: "u1", created_at: "2024-01-05T00:00:00Z" }]
            : [],
      });
    }
  }
  routes[`${API_ROOT}/projects/pa/work-items/a4/attachments/f1/`] = () => ({
    status: 302,
    headers: { location: `${storageUrl}/bucket/notes.txt?signature=abc` },
  });
  return routes;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("Plane import through runImportJob", () => {
  let userId: string;
  let planeServer: Server;
  let storageServer: Server;
  let planeUrl: string;
  const unrouted: string[] = [];
  const storageRequests: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    const { user } = await createTestUser(`plane-e2e-${Date.now()}`);
    userId = user.id;

    storageServer = createServer((req, res) => {
      storageRequests.push(req.headers);
      if (req.url !== "/bucket/notes.txt?signature=abc") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end(ATTACHMENT_BYTES);
    });
    const storageUrl = await listen(storageServer);

    let routes: ReturnType<typeof planeWorkspace> = {};
    planeServer = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://plane").pathname;
      const route = routes[path];
      if (!route) {
        unrouted.push(path);
        res.writeHead(404, { "content-type": "application/json" }).end("{}");
        return;
      }
      const { status, body, headers = {} } = route();
      res.writeHead(status, { "content-type": "application/json", ...headers }).end(body === undefined ? "" : JSON.stringify(body));
    });
    planeUrl = await listen(planeServer);
    routes = planeWorkspace(storageUrl, user.email);
  });

  afterAll(async () => {
    const attachments = await db.attachment.findMany({ where: { card: { project: { userId } } }, select: { storageKey: true } });
    for (const { storageKey } of attachments) fs.rmSync(getAttachmentFilePath(storageKey), { force: true });
    await cleanupTestUser(userId);
    await close(planeServer);
    await close(storageServer);
  });

  function cliImporter(dryRun: boolean): PlaneImporter {
    const importer: PlaneImporter = new PlaneImporter({
      baseUrl: planeUrl,
      apiKey: "plane-secret",
      workspaceSlug: "my-team",
      maxRetries: 0,
      sleep: async () => {},
      skipCrossProjectRelations: dryRun,
      isCardImported: async (cardSourceId) => !!(await findExistingMapping(userId, importer.name, "card", cardSourceId)),
    });
    return importer;
  }

  async function dryRun() {
    const importer = cliImporter(true);
    const { summary } = await runImportJob(importer, userId, { dryRun: true });
    expect(summary.mode).toBe("dry-run");
    return { importer, summary: summary as ImportDryRunSummary };
  }

  async function liveRun() {
    const { summary } = await runImportJob(cliImporter(false), userId);
    expect(summary.mode).toBe("live");
    return summary as ImportSummary;
  }

  function countByType(records: Array<{ entityType: string }>) {
    return Object.fromEntries(
      ["project", "column", "cardType", "label", "card", "comment", "attachment"].map((type) => [
        type,
        records.filter((record) => record.entityType === type).length,
      ])
    );
  }

  const EVERY_RECORD = { project: 2, column: 10, cardType: 6, label: 3, card: 6, comment: 2, attachment: 1 };

  async function cardByNumber(key: string, number: number) {
    return db.card.findFirstOrThrow({
      where: { number, project: { userId, key } },
      include: { column: true, labels: { include: { label: true } }, links: true, comments: { orderBy: { createdAt: "asc" } }, attachments: true, assignees: true },
    });
  }

  it("dry-runs, imports, re-imports and dry-runs again with consistent results", async () => {
    const first = await dryRun();
    expect(first.summary.totals).toEqual({ wouldCreate: 30, wouldSkip: 0, wouldFail: 0 });
    expect(countByType(first.summary.records)).toEqual(EVERY_RECORD);
    expect(first.summary.dropped).toEqual([{ field: UNMATCHED_ASSIGNEES, count: 1 }]);
    expect(first.importer.crossProjectRelationsSkipped).toBe(2);
    expect(await db.project.count({ where: { userId } })).toBe(0);
    expect(storageRequests).toHaveLength(0);

    const live = await liveRun();
    expect(live.records.filter((record) => record.status !== "created")).toEqual([]);
    expect(live.totals).toEqual({ created: 30, skipped: 0, failed: 0 });
    expect(countByType(live.records)).toEqual(EVERY_RECORD);
    expect(live.dropped).toEqual([
      { field: NOT_YET_IMPORTED, count: 1 },
      { field: UNMATCHED_ASSIGNEES, count: 1 },
    ]);

    const projects = await db.project.findMany({ where: { userId }, orderBy: { key: "asc" } });
    expect(projects.map((project) => [project.key, project.name, project.description])).toEqual([
      ["ALPHA", "Alpha", "First"],
      ["BETA", "Beta", null],
    ]);
    const alphaColumns = await db.column.findMany({ where: { projectId: projects[0].id }, orderBy: { order: "asc" } });
    expect(alphaColumns.map((column) => [column.name, column.group, column.isDone])).toEqual([
      ["Backlog", "BACKLOG", false],
      ["Todo", "UNSTARTED", false],
      ["In Progress", "STARTED", false],
      ["Done", "COMPLETED", true],
      ["Cancelled", "CANCELLED", false],
    ]);

    const parent = await cardByNumber("ALPHA", 1);
    expect(parent).toMatchObject({ title: "Parent", priority: "HIGH", description: "Top **level**" });
    expect(parent.column.name).toBe("In Progress");
    expect(parent.labels.map(({ label }) => [label.name, label.description])).toEqual([["bug", "Something is broken"]]);
    expect(parent.assignees.map((assignee) => assignee.userId)).toEqual([userId]);
    expect(parent.comments.map((comment) => [comment.author, comment.content])).toEqual([
      ["ada", "First"],
      ["Grace Hopper", "Second"],
    ]);

    expect((await cardByNumber("ALPHA", 2)).parentId).toBe(parent.id);

    const linked = await cardByNumber("ALPHA", 3);
    expect(linked.links.map((link) => [link.url, link.title])).toEqual([["https://example.com/spec", "Spec"]]);
    expect(linked.assignees).toEqual([]);
    expect(linked.owner).toContain("Grace Hopper");

    const withFile = await cardByNumber("ALPHA", 4);
    expect(withFile.completedAt?.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(withFile.attachments.map((file) => [file.filename, file.mimeType, file.size])).toEqual([["notes.txt", "text/plain", 5]]);
    expect(fs.readFileSync(getAttachmentFilePath(withFile.attachments[0].storageKey), "utf8")).toBe(ATTACHMENT_BYTES);
    expect(storageRequests).toHaveLength(1);
    expect(storageRequests[0]["x-api-key"]).toBeUndefined();

    const blocker = await cardByNumber("ALPHA", 5);
    const blocked = await cardByNumber("BETA", 7);
    expect(await db.cardRelation.findMany({ where: { OR: [{ sourceCardId: blocker.id }, { targetCardId: blocker.id }] }, select: { sourceCardId: true, targetCardId: true, type: true } })).toEqual([
      { sourceCardId: blocker.id, targetCardId: blocked.id, type: "BLOCKS" },
    ]);

    const rerun = await liveRun();
    expect(rerun.totals).toEqual({ created: 0, skipped: 30, failed: 0 });
    expect(rerun.dropped).toEqual([]);
    expect(await db.card.count({ where: { project: { userId } } })).toBe(6);
    expect(await db.cardRelation.count({ where: { sourceCardId: blocker.id } })).toBe(1);
    expect(await db.attachment.count({ where: { card: { project: { userId } } } })).toBe(1);
    expect(storageRequests).toHaveLength(1);

    const after = await dryRun();
    expect(after.summary.totals).toEqual({ wouldCreate: 0, wouldSkip: 30, wouldFail: 0 });
    expect(after.summary.dropped).toEqual([]);

    expect(unrouted).toEqual([]);
  }, 30_000);
});
