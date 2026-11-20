import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, executeMcpTool, readMcpResource } from "@/mcp/core";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";

const SMALL = 10;
const LARGE = 1100;
const POINTS_PER_CARD = 2;
const MAX_SIZE_DRIFT_BYTES = 32;

type OverviewColumn = { id: string; name: string; cardCount: number };
type Overview = {
  id: string;
  columns: OverviewColumn[];
  labels: { name: string }[];
  cardCount: number;
  archivedCardCount: number;
};

async function seedProject(userId: string, name: string, openCards: number) {
  const project = await createTestProject(userId, name);
  const todo = await createTestColumn(project.id, "To Do", 0);
  const done = await createTestColumn(project.id, "Done", 1);
  await db.label.create({ data: { projectId: project.id, name: "bug" } });
  await db.card.createMany({
    data: Array.from({ length: openCards }, (_, index) => ({
      projectId: project.id,
      columnId: todo.id,
      title: `Card ${index}`,
      number: index + 1,
      order: index,
      priority: "HIGH",
      points: POINTS_PER_CARD,
    })),
  });
  const archived = await db.card.create({
    data: { projectId: project.id, columnId: done.id, title: "Archived", number: openCards + 1, isArchived: true },
  });
  const first = await db.card.findFirstOrThrow({ where: { projectId: project.id, number: 1 } });
  await db.comment.create({ data: { cardId: first.id, content: "A comment", author: "Tester" } });
  return { projectId: project.id, archivedId: archived.id };
}

async function promptText(userId: string, projectId: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ userId });
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const prompt = await client.getPrompt({ name: "summarize_project", arguments: { projectId } });
    return (prompt.messages[0].content as { text: string }).text;
  } finally {
    await client.close();
  }
}

async function toolOverview(userId: string, projectId: string) {
  return ((await executeMcpTool("get_project", { id: projectId }, { userId })) as { project: Overview }).project;
}

async function resourceOverview(userId: string, projectId: string) {
  return (await readMcpResource(`opm://projects/${projectId}`, userId)).data as unknown as Overview;
}

describe("MCP project overview does not grow with card count", () => {
  let userId: string;
  let small: { projectId: string };
  let large: { projectId: string };

  beforeEach(async () => {
    userId = (await createTestUser(`mcp-overview-${Date.now()}`)).user.id;
    small = await seedProject(userId, "Small Overview", SMALL);
    large = await seedProject(userId, "Large Overview", LARGE);
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it.each([
    ["get_project", toolOverview],
    ["opm://projects/<id>", resourceOverview],
  ])("%s returns counts and no embedded cards or comments", async (_, read) => {
    const overview = await read(userId, large.projectId);

    expect(overview.columns.map((column) => [column.name, column.cardCount])).toEqual([
      ["To Do", LARGE],
      ["Done", 0],
    ]);
    expect(overview.cardCount).toBe(LARGE);
    expect(overview.archivedCardCount).toBe(1);
    expect(overview.labels.map((label) => label.name)).toEqual(["bug"]);

    const json = JSON.stringify(overview);
    expect(json).not.toContain('"cards"');
    expect(json).not.toContain('"comments"');
  });

  it.each([
    ["get_project", async (projectId: string) => JSON.stringify(await toolOverview(userId, projectId))],
    ["opm://projects/<id>", async (projectId: string) => JSON.stringify(await resourceOverview(userId, projectId))],
    ["summarize_project", (projectId: string) => promptText(userId, projectId)],
  ])("%s stays the same size for small and large projects", async (_, render) => {
    const smallSize = (await render(small.projectId)).length;
    const largeSize = (await render(large.projectId)).length;
    expect(Math.abs(largeSize - smallSize)).toBeLessThanOrEqual(MAX_SIZE_DRIFT_BYTES);
  });

  it("summarize_project reports column, priority and point totals", async () => {
    const text = await promptText(userId, large.projectId);
    const summary = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

    expect(summary.cardCount).toBe(LARGE);
    expect(summary.archivedCardCount).toBe(1);
    expect(summary.totalPoints).toBe(LARGE * POINTS_PER_CARD);
    expect(summary.cardsByPriority).toEqual({ HIGH: LARGE });
    expect(summary.columns).toEqual([
      { name: "To Do", group: "UNSTARTED", isDone: false, cardCount: LARGE, points: LARGE * POINTS_PER_CARD },
      { name: "Done", group: "UNSTARTED", isDone: false, cardCount: 0, points: 0 },
    ]);
    expect(text).toContain("list_cards");
  });
});
