import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VikunjaImporter, htmlToMarkdown, mapPriority } from "../vikunja";
import type { ImportCard, ImportColumn, ImportLabel, ImportComment, ImportProject } from "../types";

const BASE = "http://vikunja.test/api/v1";

/** Minimal stand-in for the Vikunja endpoints the adapter touches. */
function stubVikunja(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = String(url).slice(BASE.length);
    // Match on pathname + the query params the adapter varies (page).
    const [pathname, query = ""] = path.split("?");
    const page = Number(new URLSearchParams(query).get("page") || "1");
    const key = page > 1 ? `${pathname}?page=${page}` : pathname;
    if (!(key in routes)) {
      // An un-stubbed paginated follow-up page is simply empty.
      if (page > 1) return jsonResponse([]);
      throw new Error(`unexpected fetch: ${path}`);
    }
    return jsonResponse(routes[key]);
  });
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

const PROJECT_SID = "vikunja:project:2";

function defaultRoutes(overrides: Record<string, unknown> = {}) {
  return {
    "/projects": [
      { id: 2, title: "Mejengapp", description: "<p>The <strong>app</strong></p>", hex_color: "ff0000" },
      { id: 9, title: "Other board" },
    ],
    "/projects/2/views": [
      { id: 5, view_kind: "list" },
      { id: 8, view_kind: "kanban", default_bucket_id: 4, done_bucket_id: 6 },
    ],
    "/projects/2/views/8/tasks": [
      { id: 4, title: "To-Do", position: 1, tasks: [{ id: 101 }] },
      { id: 5, title: "Doing", position: 2, tasks: [{ id: 102 }] },
      { id: 6, title: "Done", position: 3, tasks: [] },
    ],
    "/projects/2/tasks": [
      {
        id: 101,
        index: 12,
        title: "Fix badge sync",
        description: "<p>Badge is <strong>stale</strong></p>",
        priority: 3,
        due_date: "2026-07-25T00:00:00Z",
        done_at: "0001-01-01T00:00:00Z",
        labels: [{ id: 7 }],
        assignees: [{ username: "jose" }],
      },
      {
        id: 102,
        index: 13,
        title: "In progress card",
        description: "",
        priority: 0,
        due_date: "0001-01-01T00:00:00Z",
      },
      {
        // Done, but the kanban view still has it filed under a non-done bucket.
        id: 103,
        index: 14,
        title: "Closed card",
        done: true,
        done_at: "2026-08-01T10:00:00Z",
        bucket_id: 4,
      },
    ],
    "/labels": [
      { id: 7, title: "bug", hex_color: "ff0000" },
      { id: 8, title: "unused-elsewhere", hex_color: "00ff00" },
    ],
    "/tasks/101/comments": [
      { id: 45, comment: "<p>Repro confirmed</p>", created: "2026-07-20T09:00:00Z", author: { username: "jose" } },
    ],
    ...overrides,
  };
}

describe("htmlToMarkdown", () => {
  it("converts the markup the board actually contains", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong></p>")).toBe("Hello **world**");
    expect(htmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
    expect(htmlToMarkdown("<ol><li>one</li><li>two</li></ol>")).toBe("1. one\n2. two");
    expect(htmlToMarkdown('<a href="https://x.test">link</a>')).toBe("[link](https://x.test)");
    expect(htmlToMarkdown("<p>use <code>vik.sh</code></p>")).toBe("use `vik.sh`");
    expect(htmlToMarkdown("line<br>break")).toBe("line\nbreak");
  });

  it("strips unsupported tags and decodes entities instead of leaking raw HTML", () => {
    expect(htmlToMarkdown('<span class="x">plain</span>')).toBe("plain");
    expect(htmlToMarkdown("<p>a &amp; b &lt;c&gt;</p>")).toBe("a & b <c>");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToMarkdown(undefined)).toBe("");
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("mapPriority", () => {
  it("maps Vikunja 0-5 onto the OPM priority enum", () => {
    expect([0, 1, 2, 3, 4, 5].map(mapPriority)).toEqual(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT", "URGENT"]);
    expect(mapPriority(undefined)).toBe("NONE");
  });
});

describe("VikunjaImporter", () => {
  let fetchStub: ReturnType<typeof stubVikunja>;

  // `null` means "no scope configured" — distinct from omitting the argument.
  function makeImporter(routes = defaultRoutes(), projectIds: number[] | null = [2]) {
    fetchStub = stubVikunja(routes);
    vi.stubGlobal("fetch", fetchStub);
    return new VikunjaImporter({ baseUrl: BASE, token: "test-token", projectIds: projectIds ?? undefined });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields only the requested projects, with stable namespaced sourceIds", async () => {
    const importer = makeImporter();
    const projects: ImportProject[] = await collect(importer.fetchProjects());

    expect(projects.length).toBe(1);
    expect(projects[0].sourceId).toBe(PROJECT_SID);
    expect(projects[0].name).toBe("Mejengapp");
    expect(projects[0].description).toBe("The **app**");
    expect(projects[0].color).toBe("#ff0000");
  });

  it("yields every project when no projectIds are configured", async () => {
    const importer = makeImporter(defaultRoutes(), null);
    const projects = await collect(importer.fetchProjects());
    expect(projects.map((p) => p.name)).toEqual(["Mejengapp", "Other board"]);
  });

  it("maps kanban buckets to columns and flags only the done bucket", async () => {
    const importer = makeImporter();
    const columns: ImportColumn[] = await collect(importer.fetchColumns(PROJECT_SID));

    expect(columns.map((c) => [c.sourceId, c.name, c.isDone])).toEqual([
      ["vikunja:bucket:4", "To-Do", false],
      ["vikunja:bucket:5", "Doing", false],
      ["vikunja:bucket:6", "Done", true],
    ]);
    expect(columns.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it("fails loudly when the project has no kanban view to map columns from", async () => {
    const importer = makeImporter(defaultRoutes({ "/projects/2/views": [{ id: 5, view_kind: "list" }] }));
    await expect(collect(importer.fetchColumns(PROJECT_SID))).rejects.toThrow(/no kanban view/);
  });

  it("imports cards into their bucket's column, forcing done tasks into the done column", async () => {
    const importer = makeImporter();
    const cards: ImportCard[] = await collect(importer.fetchCards(PROJECT_SID));

    const byId = Object.fromEntries(cards.map((c) => [c.sourceId, c]));
    expect(byId["vikunja:task:101"].columnSourceId).toBe("vikunja:bucket:4");
    expect(byId["vikunja:task:102"].columnSourceId).toBe("vikunja:bucket:5");
    // 103 is done and its bucket_id says To-Do — the done column wins.
    expect(byId["vikunja:task:103"].columnSourceId).toBe("vikunja:bucket:6");
  });

  it("carries priority, due date, assignee and completion time across", async () => {
    const importer = makeImporter();
    const cards = await collect(importer.fetchCards(PROJECT_SID));
    const card = cards.find((c) => c.sourceId === "vikunja:task:101")!;

    expect(card.title).toBe("Fix badge sync");
    expect(card.priority).toBe("HIGH");
    expect(card.dueDate).toBe("2026-07-25T00:00:00Z");
    expect(card.owner).toBe("jose");
    expect(card.labelSourceIds).toEqual(["vikunja:label:7"]);
    expect(card.description).toBe("> Imported from Vikunja #12\n\nBadge is **stale**");

    const done = cards.find((c) => c.sourceId === "vikunja:task:103")!;
    expect(done.completedAt).toBe("2026-08-01T10:00:00Z");
  });

  it("treats Vikunja's zero-date sentinel as unset", async () => {
    const importer = makeImporter();
    const cards = await collect(importer.fetchCards(PROJECT_SID));

    expect(cards.find((c) => c.sourceId === "vikunja:task:101")!.completedAt).toBeUndefined();
    expect(cards.find((c) => c.sourceId === "vikunja:task:102")!.dueDate).toBeUndefined();
  });

  it("imports only the labels this project's tasks actually use", async () => {
    const importer = makeImporter();
    const labels: ImportLabel[] = await collect(importer.fetchLabels(PROJECT_SID));

    expect(labels.map((l) => [l.sourceId, l.name, l.color])).toEqual([["vikunja:label:7", "bug", "#ff0000"]]);
  });

  it("preserves comment author and timestamp, converted to Markdown", async () => {
    const importer = makeImporter();
    const comments: ImportComment[] = await collect(importer.fetchComments("vikunja:task:101"));

    expect(comments).toEqual([
      {
        sourceId: "vikunja:comment:45",
        author: "jose",
        content: "Repro confirmed",
        createdAt: "2026-07-20T09:00:00Z",
      },
    ]);
  });

  it("yields no card types — Vikunja has no equivalent concept", async () => {
    const importer = makeImporter();
    expect(await collect(importer.fetchCardTypes())).toEqual([]);
  });

  it("surfaces Vikunja HTTP errors rather than importing a partial board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({}) }) as unknown as Response)
    );
    const importer = new VikunjaImporter({ baseUrl: BASE, token: "bad", projectIds: [2] });
    await expect(collect(importer.fetchProjects())).rejects.toThrow(/403/);
  });
});
