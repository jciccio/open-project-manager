import { describe, it, expect, afterEach, vi } from "vitest";
import { PlaneImporter, commentSourceId, labelSourceId, mapPriority, projectSourceId, stateSourceId, workItemSourceId } from "../plane";

const API = "http://plane.test/api/v1";
const WORKSPACE = "/workspaces/my-team";
const PROJECT = "p1";
const PROJECT_PATH = `${WORKSPACE}/projects/${PROJECT}`;
const PROJECT_SID = projectSourceId(PROJECT);

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function page(results: unknown[], nextCursor?: string) {
  return { results, next_cursor: nextCursor, next_page_results: !!nextCursor };
}

function stubRoutes(routes: Record<string, () => Response>) {
  const stub = vi.fn<FetchStub>(async (url) => {
    const key = String(url).slice(API.length);
    const route = routes[key] ?? routes[key.split("?")[0]];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    return route();
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function stubSequence(...responses: Array<Response | Error>) {
  const stub = vi.fn<FetchStub>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function importer(overrides: Partial<ConstructorParameters<typeof PlaneImporter>[0]> = {}) {
  const sleeps: number[] = [];
  const instance = new PlaneImporter({
    baseUrl: "http://plane.test",
    apiKey: "secret-key",
    workspaceSlug: "my-team",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
  return { instance, sleeps };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

const NO_ESTIMATE = () => respond({ error: "Estimate not found" }, 404);
const MEMBERS = () =>
  respond([
    { id: "u1", display_name: "ada" },
    { id: "u2", first_name: "Grace", last_name: "Hopper" },
  ]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlaneImporter", () => {
  it("names itself by instance and workspace", () => {
    expect(importer().instance.name).toBe("plane:plane.test/my-team");
  });

  it("accepts a base URL that already has the API path", async () => {
    const stub = stubRoutes({ [`${WORKSPACE}/projects/`]: () => respond(page([])) });
    const { instance } = importer({ baseUrl: "http://plane.test/api/v1/" });

    await collect(instance.fetchProjects());

    expect(instance.name).toBe("plane:plane.test/my-team");
    expect(String(stub.mock.calls[0][0])).toContain(`${API}${WORKSPACE}/projects/`);
  });

  it("sends the API key and never puts it in the URL", async () => {
    const stub = stubRoutes({ [`${WORKSPACE}/projects/`]: () => respond(page([])) });
    await collect(importer().instance.fetchProjects());

    const [url, init] = stub.mock.calls[0];
    expect(new Headers(init?.headers).get("x-api-key")).toBe("secret-key");
    expect(String(url)).not.toContain("secret-key");
  });

  it("follows cursors until Plane reports no more results", async () => {
    const stub = stubRoutes({
      [`${WORKSPACE}/projects/?per_page=100&cursor=100%3A0%3A0`]: () =>
        respond(page([{ id: "p1", name: "One", identifier: "ONE" }], "100:1:0")),
      [`${WORKSPACE}/projects/?per_page=100&cursor=100%3A1%3A0`]: () =>
        respond(page([{ id: "p2", name: "Two", identifier: "TWO", description: "Second" }])),
    });

    const projects = await collect(importer().instance.fetchProjects());

    expect(projects).toEqual([
      { sourceId: projectSourceId("p1"), name: "One", description: undefined, key: "ONE" },
      { sourceId: projectSourceId("p2"), name: "Two", description: "Second", key: "TWO" },
    ]);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("filters projects by identifier, ignoring case", async () => {
    stubRoutes({
      [`${WORKSPACE}/projects/`]: () =>
        respond(page([{ id: "p1", name: "One", identifier: "ONE" }, { id: "p2", name: "Two", identifier: "Two" }])),
    });

    const projects = await collect(importer({ projectIdentifiers: ["tWO"] }).instance.fetchProjects());

    expect(projects.map((p) => p.key)).toEqual(["Two"]);
  });

  it("orders columns by state sequence and marks only the completed group as done", async () => {
    stubRoutes({
      [`${PROJECT_PATH}/states/`]: () =>
        respond(
          page([
            { id: "s3", name: "Cancelled", group: "cancelled", sequence: 40000.5 },
            { id: "s2", name: "Done", group: "completed", sequence: 30000 },
            { id: "s1", name: "Backlog", group: "backlog", sequence: 15000 },
          ])
        ),
    });

    const columns = await collect(importer().instance.fetchColumns(PROJECT_SID));

    expect(columns).toEqual([
      { sourceId: stateSourceId("s1"), name: "Backlog", order: 0, isDone: false },
      { sourceId: stateSourceId("s2"), name: "Done", order: 1, isDone: true },
      { sourceId: stateSourceId("s3"), name: "Cancelled", order: 2, isDone: false },
    ]);
  });

  it("gives every project OPM's default card types, scoped to that project", async () => {
    const types = await collect(importer().instance.fetchCardTypes(PROJECT_SID));

    expect(types.map((t) => t.name)).toEqual(["Task", "Bug", "Feature"]);
    expect(types[0].sourceId).toBe(`plane:cardtype:${PROJECT}:Task`);
  });

  it("maps labels", async () => {
    stubRoutes({
      [`${PROJECT_PATH}/labels/`]: () => respond(page([{ id: "l1", name: "bug", color: "#ff0000" }, { id: "l2", name: "plain", color: "" }])),
    });

    expect(await collect(importer().instance.fetchLabels(PROJECT_SID))).toEqual([
      { sourceId: labelSourceId("l1"), name: "bug", color: "#ff0000" },
      { sourceId: labelSourceId("l2"), name: "plain", color: undefined },
    ]);
  });

  it("maps a work item onto a card", async () => {
    stubRoutes({
      [`${WORKSPACE}/members/`]: MEMBERS,
      [`${PROJECT_PATH}/estimates/`]: () => respond({ id: "e1" }),
      [`${PROJECT_PATH}/estimates/e1/estimate-points/`]: () =>
        respond([
          { id: "ep1", value: "5" },
          { id: "ep2", value: "L" },
          { id: "ep3", value: "2.5" },
        ]),
      [`${PROJECT_PATH}/work-items/`]: () =>
        respond(
          page([
            {
              id: "w1",
              name: "Fix it",
              description_html: "<p>The <strong>bug</strong></p>",
              state: "s1",
              priority: "high",
              assignees: ["u1", "u2", "gone"],
              labels: ["l1"],
              estimate_point: "ep1",
              target_date: "2026-12-01",
              completed_at: "2026-11-01T10:00:00Z",
            },
            { id: "w2", name: "Sized L", state: "s1", priority: "none", estimate_point: "ep2" },
            { id: "w3", name: "Sized 2.5", state: "s1", estimate_point: "ep3" },
          ])
        ),
    });

    const [full, nonNumeric, fractional] = await collect(importer().instance.fetchCards(PROJECT_SID));

    expect(full).toEqual({
      sourceId: workItemSourceId(PROJECT, "w1"),
      columnSourceId: stateSourceId("s1"),
      title: "Fix it",
      description: "The **bug**",
      priority: "HIGH",
      points: 5,
      owner: "ada, Grace Hopper",
      dueDate: "2026-12-01",
      completedAt: "2026-11-01T10:00:00Z",
      labelSourceIds: [labelSourceId("l1")],
    });
    expect(nonNumeric.points).toBeUndefined();
    expect(nonNumeric.owner).toBeUndefined();
    expect(fractional.points).toBeUndefined();
  });

  it("treats a 404 on estimates as a project with no estimate, without retrying", async () => {
    const stub = stubRoutes({
      [`${WORKSPACE}/members/`]: MEMBERS,
      [`${PROJECT_PATH}/estimates/`]: NO_ESTIMATE,
      [`${PROJECT_PATH}/work-items/`]: () => respond(page([{ id: "w1", name: "A", state: "s1", estimate_point: "ep1" }])),
    });

    const [card] = await collect(importer().instance.fetchCards(PROJECT_SID));

    expect(card.points).toBeUndefined();
    expect(stub.mock.calls.filter(([url]) => String(url).includes("/estimates/"))).toHaveLength(1);
  });

  it("surfaces an estimate error that is not a 404", async () => {
    stubRoutes({
      [`${WORKSPACE}/members/`]: MEMBERS,
      [`${PROJECT_PATH}/estimates/`]: () => respond({}, 403),
    });

    await expect(collect(importer().instance.fetchCards(PROJECT_SID))).rejects.toThrow("403");
  });

  it("reads comments through the card's own project, oldest first, and names their authors", async () => {
    const stub = stubRoutes({
      [`${WORKSPACE}/members/`]: MEMBERS,
      [`${PROJECT_PATH}/work-items/w1/comments/`]: () =>
        respond(
          page([
            { id: "c1", comment_html: "<p>First</p>", actor: "u1", created_at: "2026-10-01T00:00:00Z" },
            { id: "c2", comment_html: "<p>Second</p>", actor: null, created_by: "u2", created_at: "2026-10-02T00:00:00Z" },
            { id: "c3", comment_html: "<p>Third</p>", actor: "gone", created_at: "2026-10-03T00:00:00Z" },
          ])
        ),
    });

    const comments = await collect(importer().instance.fetchComments(workItemSourceId(PROJECT, "w1")));

    expect(comments).toEqual([
      { sourceId: commentSourceId("c1"), author: "ada", content: "First", createdAt: "2026-10-01T00:00:00Z" },
      { sourceId: commentSourceId("c2"), author: "Grace Hopper", content: "Second", createdAt: "2026-10-02T00:00:00Z" },
      { sourceId: commentSourceId("c3"), author: "plane", content: "Third", createdAt: "2026-10-03T00:00:00Z" },
    ]);
    expect(stub.mock.calls.some(([url]) => String(url).includes("order_by=created_at"))).toBe(true);
  });

  it("fetches workspace members only once", async () => {
    const stub = stubRoutes({
      [`${WORKSPACE}/members/`]: MEMBERS,
      [`${PROJECT_PATH}/work-items/w1/comments/`]: () => respond(page([])),
      [`${PROJECT_PATH}/work-items/w2/comments/`]: () => respond(page([])),
    });
    const { instance } = importer();

    await collect(instance.fetchComments(workItemSourceId(PROJECT, "w1")));
    await collect(instance.fetchComments(workItemSourceId(PROJECT, "w2")));

    expect(stub.mock.calls.filter(([url]) => String(url).endsWith("/members/"))).toHaveLength(1);
  });

  describe("rate limiting and retries", () => {
    const projects = () => respond(page([{ id: "p1", name: "One", identifier: "ONE" }]));
    const inSeconds = (seconds: number) => String(Math.floor(Date.now() / 1000) + seconds);

    it("waits for the window to reset before the next request once no requests remain", async () => {
      stubSequence(
        respond(page([{ id: "p1", name: "One", identifier: "ONE" }], "100:1:0"), 200, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": inSeconds(30),
        }),
        projects()
      );
      const { instance, sleeps } = importer();

      await collect(instance.fetchProjects());

      expect(sleeps).toHaveLength(1);
      expect(sleeps[0]).toBeGreaterThan(25_000);
      expect(sleeps[0]).toBeLessThanOrEqual(30_000);
    });

    it("does not wait while requests remain", async () => {
      stubSequence(
        respond(page([{ id: "p1", name: "One", identifier: "ONE" }], "100:1:0"), 200, {
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": inSeconds(30),
        }),
        projects()
      );
      const { instance, sleeps } = importer();

      await collect(instance.fetchProjects());

      expect(sleeps).toEqual([]);
    });

    it("caps the wait when the reset header is far in the future", async () => {
      stubSequence(
        respond(page([], "100:1:0"), 200, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": inSeconds(86_400) }),
        projects()
      );
      const { instance, sleeps } = importer();

      await collect(instance.fetchProjects());

      expect(sleeps).toEqual([120_000]);
    });

    it("honours Retry-After on a 429", async () => {
      const stub = stubSequence(respond({}, 429, { "retry-after": "7" }), projects());
      const { instance, sleeps } = importer();

      expect(await collect(instance.fetchProjects())).toHaveLength(1);
      expect(sleeps).toEqual([7000]);
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it("waits for the rate limit reset on a 429 without Retry-After", async () => {
      stubSequence(respond({}, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": inSeconds(20) }), projects());
      const { instance, sleeps } = importer();

      await collect(instance.fetchProjects());

      expect(sleeps).toHaveLength(1);
      expect(sleeps[0]).toBeGreaterThan(15_000);
      expect(sleeps[0]).toBeLessThanOrEqual(20_000);
    });

    it("backs off exponentially on 5xx", async () => {
      stubSequence(respond({}, 503), respond({}, 500), projects());
      const { instance, sleeps } = importer();

      expect(await collect(instance.fetchProjects())).toHaveLength(1);
      expect(sleeps).toEqual([1000, 2000]);
    });

    it("gives up after maxRetries on 5xx", async () => {
      const stub = stubSequence(respond({}, 500), respond({}, 500), respond({}, 500));
      const { instance } = importer({ maxRetries: 2 });

      await expect(collect(instance.fetchProjects())).rejects.toThrow("500");
      expect(stub).toHaveBeenCalledTimes(3);
    });

    it("does not retry a client error", async () => {
      const stub = stubSequence(respond({}, 401));
      const { instance, sleeps } = importer();

      await expect(collect(instance.fetchProjects())).rejects.toThrow("401");
      expect(stub).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
    });

    it("retries a network error and a timeout", async () => {
      const timeout = new Error("timed out");
      timeout.name = "TimeoutError";
      stubSequence(new TypeError("fetch failed"), timeout, projects());
      const { instance, sleeps } = importer();

      expect(await collect(instance.fetchProjects())).toHaveLength(1);
      expect(sleeps).toEqual([1000, 2000]);
    });

    it("reports a timeout clearly once retries run out", async () => {
      const timeout = new Error("timed out");
      timeout.name = "TimeoutError";
      stubSequence(timeout);
      const { instance } = importer({ maxRetries: 0, timeoutMs: 50 });

      await expect(collect(instance.fetchProjects())).rejects.toThrow("timed out after 50ms");
    });
  });
});

describe("mapPriority", () => {
  it.each([
    ["urgent", "URGENT"],
    ["high", "HIGH"],
    ["medium", "MEDIUM"],
    ["low", "LOW"],
    ["none", "NONE"],
    ["something-new", "NONE"],
    [undefined, "NONE"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapPriority(input)).toBe(expected);
  });
});
