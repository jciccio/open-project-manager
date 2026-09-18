import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

describe("MCP tools: cross-user ownership enforcement", () => {
  let ownerId: string;
  let intruderId: string;
  let projectId: string;
  let projectKey: string;
  let columnId: string;
  let cardId: string;
  let cardNumber: number;
  let otherCardId: string;
  let commentId: string;
  let relationId: string;
  let linkId: string;
  let cardTypeId: string;
  let labelId: string;
  let savedViewId: string;

  beforeEach(async () => {
    const owner = await createTestUser(`mcp-owner-${Date.now()}`);
    ownerId = owner.user.id;
    const intruder = await createTestUser(`mcp-intruder-${Date.now()}`);
    intruderId = intruder.user.id;

    const projRes = await executeMcpTool("create_project", { name: "Owner Project" }, { userId: ownerId });
    projectId = projRes.project!.id;
    projectKey = projRes.project!.key;
    columnId = (projRes.project as any).columns[0].id;

    const cardRes = await executeMcpTool(
      "create_card",
      { projectId, columnId, title: "Owner Card" },
      { userId: ownerId }
    );
    cardId = cardRes.card!.id;
    cardNumber = cardRes.card!.number;

    const otherCardRes = await executeMcpTool(
      "create_card",
      { projectId, columnId, title: "Owner Card 2" },
      { userId: ownerId }
    );
    otherCardId = otherCardRes.card!.id;

    const commentRes = await executeMcpTool(
      "add_comment",
      { cardId, author: "Owner", content: "secret" },
      { userId: ownerId }
    );
    commentId = commentRes.comment!.id;

    const relRes = await executeMcpTool(
      "add_card_relation",
      { sourceCardId: cardId, targetCardId: otherCardId },
      { userId: ownerId }
    );
    relationId = relRes.relation!.id;

    const linkRes = await executeMcpTool(
      "add_card_link",
      { cardId, url: "https://example.com" },
      { userId: ownerId }
    );
    linkId = linkRes.link!.id;

    const typeRes = await executeMcpTool(
      "create_card_type",
      { projectId, name: "Epic" },
      { userId: ownerId }
    );
    cardTypeId = typeRes.cardType!.id;

    const labelRes = await executeMcpTool("create_label", { name: "Personal" }, { userId: ownerId });
    labelId = labelRes.label!.id;

    const viewRes = await executeMcpTool(
      "create_saved_view",
      { projectId, name: "My View" },
      { userId: ownerId }
    );
    savedViewId = viewRes.savedView!.id;
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(intruderId);
  });

  it("rejects every ID-scoped tool call from a non-owner", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["get_project", { id: projectId }],
      ["update_project", { id: projectId, name: "Hacked" }],
      ["delete_project", { id: projectId }],
      ["list_columns", { projectId }],
      ["create_column", { projectId, name: "Hacked Col" }],
      ["update_column", { id: columnId, name: "Hacked" }],
      ["delete_column", { id: columnId }],
      ["get_card", { id: cardId }],
      ["get_card_by_identifier", { identifier: `${projectKey}-${cardNumber}` }],
      ["update_card", { id: cardId, title: "Hacked" }],
      ["move_card", { id: cardId, targetColumnId: columnId }],
      ["reorder_cards", { items: [{ id: cardId, order: 0 }] }],
      ["delete_card", { id: cardId }],
      ["archive_card", { id: cardId }],
      ["unarchive_card", { id: cardId }],
      ["add_comment", { cardId, author: "Intruder", content: "x" }],
      ["list_comments", { cardId }],
      ["list_card_activity", { cardId }],
      ["update_comment", { commentId, content: "Hacked" }],
      ["add_card_relation", { sourceCardId: cardId, targetCardId: otherCardId }],
      ["remove_card_relation", { relationId }],
      ["get_card_relations", { cardId }],
      ["list_card_types", { projectId }],
      ["create_card_type", { projectId, name: "Hacked" }],
      ["update_card_type", { id: cardTypeId, name: "Hacked" }],
      ["delete_card_type", { id: cardTypeId }],
      ["list_attachments", { cardId }],
      ["add_card_link", { cardId, url: "https://evil.com" }],
      ["remove_card_link", { linkId }],
      ["list_saved_views", { projectId }],
      ["create_saved_view", { projectId, name: "Hacked" }],
      ["update_saved_view", { id: savedViewId, name: "Hacked" }],
      ["delete_saved_view", { id: savedViewId }],
    ];

    for (const [tool, args] of cases) {
      await expect(
        executeMcpTool(tool, args, { userId: intruderId }),
        `tool '${tool}' should reject a non-owner`
      ).rejects.toThrow();
    }
  });

  it("scopes list_projects, list_cards, and personal labels to the caller", async () => {
    const projects = await executeMcpTool("list_projects", {}, { userId: intruderId });
    expect(projects.projects!.some((p: { id: string }) => p.id === projectId)).toBe(false);

    const cards = await executeMcpTool("list_cards", {}, { userId: intruderId });
    expect(cards.cards!.some((c: { id: string }) => c.id === cardId)).toBe(false);

    const labels = await executeMcpTool("list_labels", {}, { userId: intruderId });
    expect(labels.labels!.some((l: { id: string }) => l.id === labelId)).toBe(false);
  });
});
