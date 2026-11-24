import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeMcpTool, MCP_TOOLS } from "../core";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestCard, createTestColumn, createTestProject, createTestUser } from "@/test/helpers";

vi.mock("@/lib/webhooks", () => ({ triggerWebhooks: vi.fn() }));

function uniqueKey(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`.toUpperCase();
}

describe("MCP move_card_to_project", () => {
  let userId: string;
  let source: { id: string; key: string };
  let target: { id: string; key: string };
  let sourceColumnId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`mcp-transfer-${Date.now()}`)).user.id;
    source = await createTestProject(userId, "MCP Source", uniqueKey("MS"));
    target = await createTestProject(userId, "MCP Target", uniqueKey("MT"));
    sourceColumnId = (await createTestColumn(source.id)).id;
    await createTestColumn(target.id);
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("is listed as a tool", () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toContain("move_card_to_project");
  });

  it("moves the card and its old identifier still resolves", async () => {
    const card = await createTestCard(source.id, sourceColumnId, "Filed in the wrong project");

    const res = await executeMcpTool("move_card_to_project", { id: card.id, targetProjectId: target.id }, { userId });

    expect(res.moved).toEqual([{ from: `${source.key}-1`, to: `${target.key}-1` }]);
    expect(res.card!.identifier).toBe(`${target.key}-1`);
    const lookup = await executeMcpTool("get_card_by_identifier", { identifier: `${source.key}-1` }, { userId });
    expect(lookup.card!.id).toBe(card.id);
    expect(lookup.card!.identifier).toBe(`${target.key}-1`);
  });

  it("rejects moving a subtask on its own", async () => {
    const parent = await createTestCard(source.id, sourceColumnId, "Parent");
    const child = await createTestCard(source.id, sourceColumnId, "Child");
    await db.card.update({ where: { id: child.id }, data: { parentId: parent.id } });

    await expect(
      executeMcpTool("move_card_to_project", { id: child.id, targetProjectId: target.id }, { userId })
    ).rejects.toThrow("Move the parent instead");
  });

  it("does not resolve an old identifier for a caller without access to the card's new project", async () => {
    const outsider = (await createTestUser(`mcp-transfer-outsider-${Date.now()}`)).user;
    await db.projectMember.create({ data: { projectId: source.id, userId: outsider.id, role: "VIEWER" } });
    const card = await createTestCard(source.id, sourceColumnId);
    await executeMcpTool("move_card_to_project", { id: card.id, targetProjectId: target.id }, { userId });

    await expect(
      executeMcpTool("get_card_by_identifier", { identifier: `${source.key}-1` }, { userId: outsider.id })
    ).rejects.toThrow("not found");
    await cleanupTestUser(outsider.id);
  });
});
