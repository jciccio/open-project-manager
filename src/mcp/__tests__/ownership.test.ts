import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

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
    columnId = (projRes.project as unknown as { columns: { id: string }[] }).columns[0].id;

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
      ["add_comment", { cardId, content: "x" }],
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

  it("lets project members act at their role, matching the services", async () => {
    const asMember = { userId: intruderId };
    const membership = await db.projectMember.create({
      data: { projectId, userId: intruderId, role: "VIEWER" },
    });

    const projects = await executeMcpTool("list_projects", {}, asMember);
    expect(projects.projects!.some((p: { id: string }) => p.id === projectId)).toBe(true);
    const cards = await executeMcpTool("list_cards", { projectId }, asMember);
    expect(cards.cards!.some((c: { id: string }) => c.id === cardId)).toBe(true);
    expect((await executeMcpTool("get_card", { id: cardId }, asMember)).card!.id).toBe(cardId);
    expect(
      (await executeMcpTool("get_card_by_identifier", { identifier: `${projectKey}-${cardNumber}` }, asMember)).card!.id
    ).toBe(cardId);
    await expect(
      executeMcpTool("create_card", { projectId, columnId, title: "Viewer Card" }, asMember)
    ).rejects.toThrow();

    await db.projectMember.update({ where: { id: membership.id }, data: { role: "MEMBER" } });
    const created = await executeMcpTool("create_card", { projectId, columnId, title: "Member Card" }, asMember);
    expect(created.card!.projectId).toBe(projectId);
    await executeMcpTool("update_card", { id: cardId, title: "Edited by member" }, asMember);
    await expect(executeMcpTool("create_column", { projectId, name: "Nope" }, asMember)).rejects.toThrow();

    await db.projectMember.update({ where: { id: membership.id }, data: { role: "ADMIN" } });
    const column = await executeMcpTool("create_column", { projectId, name: "Admin Column" }, asMember);
    expect(column.column!.projectId).toBe(projectId);
    await expect(executeMcpTool("delete_project", { id: projectId }, asMember)).rejects.toThrow();
  });

  it("returns identical 'not found' error messages for existing vs non-existing IDs to non-members on create_card and update_card", async () => {
    const asIntruder = { userId: intruderId };
    const missingProjectId = "non-existent-project-id";
    const missingCardId = "non-existent-card-id";

    await expect(
      executeMcpTool("create_card", { projectId, columnId, title: "Probe" }, asIntruder)
    ).rejects.toThrow(`Project with ID ${projectId} not found.`);

    await expect(
      executeMcpTool("create_card", { projectId: missingProjectId, columnId, title: "Probe" }, asIntruder)
    ).rejects.toThrow(`Project with ID ${missingProjectId} not found.`);

    await expect(
      executeMcpTool("update_card", { id: cardId, title: "Probe" }, asIntruder)
    ).rejects.toThrow(`Card with ID ${cardId} not found.`);

    await expect(
      executeMcpTool("update_card", { id: missingCardId, title: "Probe" }, asIntruder)
    ).rejects.toThrow(`Card with ID ${missingCardId} not found.`);
  });

  describe("add_card_relation target access", () => {
    const asIntruder = () => ({ userId: intruderId });

    async function createIntruderCard() {
      const project = await executeMcpTool("create_project", { name: "Intruder Project" }, asIntruder());
      const column = (project.project as unknown as { columns: { id: string }[] }).columns[0];
      const card = await executeMcpTool(
        "create_card",
        { projectId: project.project!.id, columnId: column.id, title: "Intruder Card" },
        asIntruder()
      );
      return card.card!.id as string;
    }

    it("reports a target in a project the caller can't view as not found and creates no row", async () => {
      const sourceCardId = await createIntruderCard();

      await expect(
        executeMcpTool("add_card_relation", { sourceCardId, targetCardId: cardId }, asIntruder())
      ).rejects.toThrow(`Card with ID ${cardId} not found.`);

      expect(await db.cardRelation.count({ where: { sourceCardId } })).toBe(0);
    });

    it("still lets a VIEWER of the target's project relate to its card", async () => {
      const sourceCardId = await createIntruderCard();
      await db.projectMember.create({ data: { projectId, userId: intruderId, role: "VIEWER" } });

      const res = await executeMcpTool("add_card_relation", { sourceCardId, targetCardId: cardId }, asIntruder());

      expect(res.relation).toMatchObject({ sourceCardId, targetCardId: cardId, type: "BLOCKS" });
    });
  });
});
