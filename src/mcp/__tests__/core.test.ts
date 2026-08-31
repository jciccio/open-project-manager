import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool, MCP_TOOLS, createMcpServer } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

describe("MCP Server Core Tools", () => {
  let userId: string;

  beforeEach(async () => {
    const res = await createTestUser(`mcp-core-${Date.now()}`);
    userId = res.user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("exports a list of valid MCP tools", () => {
    expect(Array.isArray(MCP_TOOLS)).toBe(true);
    expect(MCP_TOOLS.length).toBeGreaterThan(10);
    const toolNames = MCP_TOOLS.map((t) => t.name);
    expect(toolNames).toContain("create_project");
    expect(toolNames).toContain("create_card");
    expect(toolNames).toContain("add_comment");
  });

  it("executes project, column, card, comment, and label tools correctly", async () => {
    // 1. Create Project via MCP tool
    const projRes = await executeMcpTool("create_project", {
      name: "MCP Test Project",
      userId,
      description: "Testing via MCP",
    }, { userId });
    expect(projRes.success).toBe(true);
    const projectId = projRes.project!.id;
    expect((projRes.project as any)?.columns?.length).toBe(4);

    // 2. List Projects
    const listProjRes = await executeMcpTool("list_projects", { userId }, { userId });
    expect(listProjRes.success).toBe(true);
    expect(listProjRes.projects?.length).toBeGreaterThanOrEqual(1);

    // 3. Get Project
    const getProjRes = await executeMcpTool("get_project", { id: projectId }, { userId });
    expect(getProjRes.success).toBe(true);
    const firstColId = (getProjRes.project as any).columns[0].id;
    const secondColId = (getProjRes.project as any).columns[1].id;

    // 4. Create Card via MCP tool
    const cardRes = await executeMcpTool("create_card", {
      projectId,
      columnId: firstColId,
      title: "MCP Task Card",
      priority: "HIGH",
      points: 5,
    }, { userId });
    expect(cardRes.success).toBe(true);
    const cardId = cardRes.card!.id;

    // 5. Move Card via MCP tool
    const moveRes = await executeMcpTool("move_card", {
      id: cardId,
      targetColumnId: secondColId,
      newOrder: 0,
    }, { userId });
    expect(moveRes.success).toBe(true);
    expect(moveRes.card?.columnId).toBe(secondColId);

    // 6. Add Comment via MCP tool
    const commentRes = await executeMcpTool("add_comment", {
      cardId,
      author: "AI Agent",
      content: "Automated test comment",
    }, { userId });
    expect(commentRes.success).toBe(true);
    expect(commentRes.comment?.content).toBe("Automated test comment");

    // 7. Create Label via MCP tool
    const labelRes = await executeMcpTool("create_label", {
      name: "Automated",
      color: "#ec4899",
      userId,
    }, { userId });
    expect(labelRes.success).toBe(true);

    // 8. Delete Card, Column, Project
    await executeMcpTool("delete_card", { id: cardId }, { userId });
    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports limit and cursor pagination in list_cards tool", async () => {
    const projRes = await executeMcpTool("create_project", {
      name: "Pagination Test Project",
      userId,
    }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const card1 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 1" }, { userId });
    const card2 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 2" }, { userId });
    const card3 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 3" }, { userId });

    // Fetch page 1 (limit: 2)
    const page1 = await executeMcpTool("list_cards", { projectId, limit: 2 }, { userId });
    expect(page1.success).toBe(true);
    expect(page1.cards!.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.nextCursor).not.toBeNull();

    // Fetch page 2 (using cursor from page 1)
    const page2 = await executeMcpTool("list_cards", { projectId, limit: 2, cursor: page1.nextCursor }, { userId });
    expect(page2.success).toBe(true);
    expect(page2.cards!.length).toBe(1);
    expect(page2.cards![0].title).toBe("Card 3");
    expect(page2.nextCursor).toBeNull();

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("defaults to a bounded page size when list_cards is called with no limit or cursor", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Default Limit MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    await db.card.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        projectId,
        columnId: colId,
        title: `Bulk Card ${i}`,
        number: i + 1,
        order: (i + 1) * 10000,
      })),
    });

    const res = await executeMcpTool("list_cards", { projectId }, { userId });
    expect(res.success).toBe(true);
    expect(res.cards!.length).toBe(100);
    expect(res.nextCursor).not.toBeNull();

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("filters by query across title and description in list_cards tool", async () => {
    const projRes = await executeMcpTool("create_project", {
      name: "Search Test Project",
      userId,
    }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Fix login bug",
      description: "Users can't sign in with SSO",
    }, { userId });
    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Update onboarding docs",
    }, { userId });
    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Refactor sidebar",
      description: "unrelated to login",
    }, { userId });

    const titleMatch = await executeMcpTool("list_cards", { projectId, query: "LOGIN" }, { userId });
    expect(titleMatch.success).toBe(true);
    expect(titleMatch.cards!.length).toBe(2);

    const descMatch = await executeMcpTool("list_cards", { projectId, query: "onboarding" }, { userId });
    expect(descMatch.cards!.length).toBe(1);
    expect(descMatch.cards![0].title).toBe("Update onboarding docs");

    const noMatch = await executeMcpTool("list_cards", { projectId, query: "nonexistentterm" }, { userId });
    expect(noMatch.cards!.length).toBe(0);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("throws an error for unknown tool names", async () => {
    await expect(executeMcpTool("non_existent_tool", {}, { userId })).rejects.toThrow("Unknown MCP tool: non_existent_tool");
  });

  it("initializes MCP Server instance", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it("includes tool annotations (readOnlyHint, destructiveHint) on MCP tools", () => {
    const listProjects = MCP_TOOLS.find((t) => t.name === "list_projects");
    expect(listProjects?.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    });

    const deleteProject = MCP_TOOLS.find((t) => t.name === "delete_project");
    expect(deleteProject?.annotations).toEqual({
      destructiveHint: true,
    });

    const createProject = MCP_TOOLS.find((t) => t.name === "create_project");
    expect(createProject?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it("supports reorder_cards MCP tool", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Reorder MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const c1 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 1" }, { userId });
    const c2 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 2" }, { userId });

    expect(c1.card!.order).toBe(10000);
    expect(c2.card!.order).toBe(20000);

    const reorderRes = await executeMcpTool("reorder_cards", {
      items: [
        { id: c1.card!.id, order: 25000 },
        { id: c2.card!.id, order: 5000 },
      ],
    }, { userId });
    expect(reorderRes.success).toBe(true);
    expect(reorderRes.count).toBe(2);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports parent/sub-card nesting in MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Nesting MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const parent = await executeMcpTool("create_card", { projectId, columnId: colId, title: "MCP Parent" }, { userId });
    const parentId = parent.card!.id;

    const child = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "MCP Child",
      parentId,
    }, { userId });
    expect(child.success).toBe(true);
    expect(child.card!.parentId).toBe(parentId);

    const getParentRes = await executeMcpTool("get_card", { id: parentId }, { userId });
    expect((getParentRes.card as any).children.length).toBe(1);
    expect((getParentRes.card as any).children[0].title).toBe("MCP Child");

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports assigneeIds and assignedTo filter in MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Assignee MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const createRes = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "MCP Assigned Card",
      assigneeIds: [userId],
    }, { userId });
    expect(createRes.success).toBe(true);
    expect((createRes.card as any).assignees.length).toBe(1);
    expect((createRes.card as any).assignees[0].userId).toBe(userId);

    const listRes = await executeMcpTool("list_cards", { projectId, assignedTo: userId }, { userId });
    expect(listRes.success).toBe(true);
    expect(listRes.cards!.length).toBe(1);
    expect(listRes.cards![0].title).toBe("MCP Assigned Card");

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("seeds default card types on project creation via MCP", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Card Type Seed MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    expect((projRes.project as any).cardTypes.length).toBeGreaterThan(0);

    const listRes = await executeMcpTool("list_card_types", { projectId }, { userId });
    expect(listRes.success).toBe(true);
    expect(listRes.cardTypes!.some((ct: any) => ct.name === "Bug")).toBe(true);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports full CRUD and typeId filtering via MCP card_type tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Card Type CRUD MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const createTypeRes = await executeMcpTool("create_card_type", {
      projectId,
      name: "Chore",
      icon: "Wrench",
      color: "#f97316",
    }, { userId });
    expect(createTypeRes.success).toBe(true);
    const typeId = createTypeRes.cardType!.id;

    const updateTypeRes = await executeMcpTool("update_card_type", { id: typeId, name: "Maintenance" }, { userId });
    expect(updateTypeRes.success).toBe(true);
    expect(updateTypeRes.cardType!.name).toBe("Maintenance");

    const createCardRes = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Typed MCP Card",
      typeId,
    }, { userId });
    expect(createCardRes.success).toBe(true);
    expect((createCardRes.card as any).type.id).toBe(typeId);

    const listCardsRes = await executeMcpTool("list_cards", { projectId, typeId }, { userId });
    expect(listCardsRes.success).toBe(true);
    expect(listCardsRes.cards!.length).toBe(1);

    const updateCardRes = await executeMcpTool("update_card", { id: createCardRes.card!.id, typeId: "" }, { userId });
    expect(updateCardRes.success).toBe(true);
    expect((updateCardRes.card as any).type).toBe(null);

    const deleteTypeRes = await executeMcpTool("delete_card_type", { id: typeId }, { userId });
    expect(deleteTypeRes.success).toBe(true);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("lists card activity via list_card_activity MCP tool", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Activity MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const createCardRes = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Task for MCP Activity",
    }, { userId });
    const cardId = createCardRes.card!.id;

    // Manually create an activity or use db / actions
    await db.activity.create({
      data: {
        cardId,
        actorUserId: userId,
        type: "card_created",
        toValue: "Task for MCP Activity",
      },
    });

    const actRes = await executeMcpTool("list_card_activity", { cardId }, { userId });
    expect(actRes.success).toBe(true);
    expect(actRes.activities!.length).toBeGreaterThan(0);
    expect(actRes.activities![0].type).toBe("card_created");

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports add_card_link and remove_card_link MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Links MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const createRes = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Card With Links",
    }, { userId });
    const cardId = createRes.card!.id;

    const addRes = await executeMcpTool("add_card_link", {
      cardId,
      url: "https://example.com",
      title: "Example",
    }, { userId });
    expect(addRes.success).toBe(true);
    expect(addRes.link?.url).toBe("https://example.com");

    const linkId = addRes.link!.id;

    const removeRes = await executeMcpTool("remove_card_link", { linkId }, { userId });
    expect(removeRes.success).toBe(true);
    expect(removeRes.deletedId).toBe(linkId);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });

  it("supports saved views CRUD via MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Saved Views MCP Project", userId }, { userId });
    const projectId = projRes.project!.id;

    // 1. Create saved view
    const createRes = await executeMcpTool("create_saved_view", {
      projectId,
      name: "MCP View 1",
      filterJson: JSON.stringify({ priority: "HIGH" }),
      isDefault: true,
    }, { userId });
    expect(createRes.success).toBe(true);
    expect(createRes.savedView!.name).toBe("MCP View 1");
    expect(createRes.savedView!.isDefault).toBe(true);
    const viewId = createRes.savedView!.id;

    // 2. List saved views
    const listRes = await executeMcpTool("list_saved_views", { projectId }, { userId });
    expect(listRes.success).toBe(true);
    expect(listRes.savedViews!.length).toBe(1);
    expect(listRes.savedViews![0].id).toBe(viewId);

    // 3. Update saved view
    const updateRes = await executeMcpTool("update_saved_view", {
      id: viewId,
      name: "Updated MCP View",
      isDefault: false,
    }, { userId });
    expect(updateRes.success).toBe(true);
    expect(updateRes.savedView!.name).toBe("Updated MCP View");
    expect(updateRes.savedView!.isDefault).toBe(false);

    // 4. Delete saved view
    const deleteRes = await executeMcpTool("delete_saved_view", { id: viewId }, { userId });
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.deletedId).toBe(viewId);

    await executeMcpTool("delete_project", { id: projectId }, { userId });
  });
});

