import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool, MCP_TOOLS, createMcpServer } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

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
    });
    expect(projRes.success).toBe(true);
    const projectId = projRes.project!.id;
    expect((projRes.project as any)?.columns?.length).toBe(4);

    // 2. List Projects
    const listProjRes = await executeMcpTool("list_projects", { userId });
    expect(listProjRes.success).toBe(true);
    expect(listProjRes.projects?.length).toBeGreaterThanOrEqual(1);

    // 3. Get Project
    const getProjRes = await executeMcpTool("get_project", { id: projectId });
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
    });
    expect(cardRes.success).toBe(true);
    const cardId = cardRes.card!.id;

    // 5. Move Card via MCP tool
    const moveRes = await executeMcpTool("move_card", {
      id: cardId,
      targetColumnId: secondColId,
      newOrder: 0,
    });
    expect(moveRes.success).toBe(true);
    expect(moveRes.card?.columnId).toBe(secondColId);

    // 6. Add Comment via MCP tool
    const commentRes = await executeMcpTool("add_comment", {
      cardId,
      author: "AI Agent",
      content: "Automated test comment",
    });
    expect(commentRes.success).toBe(true);
    expect(commentRes.comment?.content).toBe("Automated test comment");

    // 7. Create Label via MCP tool
    const labelRes = await executeMcpTool("create_label", {
      name: "Automated",
      color: "#ec4899",
      userId,
    });
    expect(labelRes.success).toBe(true);

    // 8. Delete Card, Column, Project
    await executeMcpTool("delete_card", { id: cardId });
    await executeMcpTool("delete_project", { id: projectId });
  });

  it("supports limit and cursor pagination in list_cards tool", async () => {
    const projRes = await executeMcpTool("create_project", {
      name: "Pagination Test Project",
      userId,
    });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const card1 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 1" });
    const card2 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 2" });
    const card3 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 3" });

    // Fetch page 1 (limit: 2)
    const page1 = await executeMcpTool("list_cards", { projectId, limit: 2 });
    expect(page1.success).toBe(true);
    expect(page1.cards!.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.nextCursor).not.toBeNull();

    // Fetch page 2 (using cursor from page 1)
    const page2 = await executeMcpTool("list_cards", { projectId, limit: 2, cursor: page1.nextCursor });
    expect(page2.success).toBe(true);
    expect(page2.cards!.length).toBe(1);
    expect(page2.cards![0].title).toBe("Card 3");
    expect(page2.nextCursor).toBeNull();

    await executeMcpTool("delete_project", { id: projectId });
  });

  it("filters by query across title and description in list_cards tool", async () => {
    const projRes = await executeMcpTool("create_project", {
      name: "Search Test Project",
      userId,
    });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Fix login bug",
      description: "Users can't sign in with SSO",
    });
    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Update onboarding docs",
    });
    await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "Refactor sidebar",
      description: "unrelated to login",
    });

    const titleMatch = await executeMcpTool("list_cards", { projectId, query: "LOGIN" });
    expect(titleMatch.success).toBe(true);
    expect(titleMatch.cards!.length).toBe(2);

    const descMatch = await executeMcpTool("list_cards", { projectId, query: "onboarding" });
    expect(descMatch.cards!.length).toBe(1);
    expect(descMatch.cards![0].title).toBe("Update onboarding docs");

    const noMatch = await executeMcpTool("list_cards", { projectId, query: "nonexistentterm" });
    expect(noMatch.cards!.length).toBe(0);

    await executeMcpTool("delete_project", { id: projectId });
  });

  it("throws an error for unknown tool names", async () => {
    await expect(executeMcpTool("non_existent_tool")).rejects.toThrow("Unknown MCP tool: non_existent_tool");
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
    const projRes = await executeMcpTool("create_project", { name: "Reorder MCP Project", userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const c1 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 1" });
    const c2 = await executeMcpTool("create_card", { projectId, columnId: colId, title: "Card 2" });

    expect(c1.card!.order).toBe(10000);
    expect(c2.card!.order).toBe(20000);

    const reorderRes = await executeMcpTool("reorder_cards", {
      items: [
        { id: c1.card!.id, order: 25000 },
        { id: c2.card!.id, order: 5000 },
      ],
    });
    expect(reorderRes.success).toBe(true);
    expect(reorderRes.count).toBe(2);

    await executeMcpTool("delete_project", { id: projectId });
  });

  it("supports parent/sub-card nesting in MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Nesting MCP Project", userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const parent = await executeMcpTool("create_card", { projectId, columnId: colId, title: "MCP Parent" });
    const parentId = parent.card!.id;

    const child = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "MCP Child",
      parentId,
    });
    expect(child.success).toBe(true);
    expect(child.card!.parentId).toBe(parentId);

    const getParentRes = await executeMcpTool("get_card", { id: parentId });
    expect((getParentRes.card as any).children.length).toBe(1);
    expect((getParentRes.card as any).children[0].title).toBe("MCP Child");

    await executeMcpTool("delete_project", { id: projectId });
  });

  it("supports assigneeIds and assignedTo filter in MCP tools", async () => {
    const projRes = await executeMcpTool("create_project", { name: "Assignee MCP Project", userId });
    const projectId = projRes.project!.id;
    const colId = (projRes.project as any).columns[0].id;

    const createRes = await executeMcpTool("create_card", {
      projectId,
      columnId: colId,
      title: "MCP Assigned Card",
      assigneeIds: [userId],
    });
    expect(createRes.success).toBe(true);
    expect((createRes.card as any).assignees.length).toBe(1);
    expect((createRes.card as any).assignees[0].userId).toBe(userId);

    const listRes = await executeMcpTool("list_cards", { projectId, assignedTo: userId });
    expect(listRes.success).toBe(true);
    expect(listRes.cards!.length).toBe(1);
    expect(listRes.cards![0].title).toBe("MCP Assigned Card");

    await executeMcpTool("delete_project", { id: projectId });
  });
});
