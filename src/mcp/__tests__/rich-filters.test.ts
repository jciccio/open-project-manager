import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

describe("MCP Rich Card Filters & Counts (#135)", () => {
  let userId: string;
  let projectId: string;
  let colTodoId: string;
  let colDoneId: string;
  let labelBugId: string;
  let labelFeatureId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`mcp-rf-${Date.now()}`);
    userId = userRes.user.id;

    const projRes = await executeMcpTool(
      "create_project",
      { name: "Rich Filter Project", userId },
      { userId }
    );
    projectId = projRes.project!.id;
    const columns = (projRes.project as any).columns;
    colTodoId = columns.find((c: any) => c.name === "To Do").id;
    colDoneId = columns.find((c: any) => c.name === "Done").id;

    // Create labels
    const bugRes = await executeMcpTool(
      "create_label",
      { name: "Bug", color: "#ef4444", projectId },
      { userId }
    );
    labelBugId = bugRes.label!.id;

    const featureRes = await executeMcpTool(
      "create_label",
      { name: "Feature", color: "#3b82f6", projectId },
      { userId }
    );
    labelFeatureId = featureRes.label!.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("filters cards by labelIds", async () => {
    const c1 = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Bug Task", labelIds: [labelBugId] },
      { userId }
    );
    const c2 = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Feature Task", labelIds: [labelFeatureId] },
      { userId }
    );
    const c3 = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Unlabeled Task" },
      { userId }
    );

    const bugList = await executeMcpTool(
      "list_cards",
      { projectId, labelIds: [labelBugId] },
      { userId }
    );
    expect(bugList.cards.length).toBe(1);
    expect(bugList.cards[0].id).toBe(c1.card!.id);

    const featureList = await executeMcpTool(
      "list_cards",
      { projectId, labelIds: [labelFeatureId] },
      { userId }
    );
    expect(featureList.cards.length).toBe(1);
    expect(featureList.cards[0].id).toBe(c2.card!.id);

    const multiList = await executeMcpTool(
      "list_cards",
      { projectId, labelIds: [labelBugId, labelFeatureId] },
      { userId }
    );
    expect(multiList.cards.length).toBe(2);
  });

  it("filters cards by dueBefore, dueAfter, and isOverdue", async () => {
    // Card due in the past
    const pastCard = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Past Due", dueDate: "2026-01-01T00:00:00Z" },
      { userId }
    );
    // Card due in the future
    const futureCard = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Future Due", dueDate: "2026-12-31T00:00:00Z" },
      { userId }
    );
    // Card with no due date
    const noDueCard = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "No Due Date" },
      { userId }
    );

    // dueBefore 2026-06-01
    const beforeList = await executeMcpTool(
      "list_cards",
      { projectId, dueBefore: "2026-06-01" },
      { userId }
    );
    expect(beforeList.cards.map((c: any) => c.id)).toEqual([pastCard.card!.id]);

    // dueAfter 2026-06-01
    const afterList = await executeMcpTool(
      "list_cards",
      { projectId, dueAfter: "2026-06-01" },
      { userId }
    );
    expect(afterList.cards.map((c: any) => c.id)).toEqual([futureCard.card!.id]);

    // isOverdue: true
    const overdueList = await executeMcpTool(
      "list_cards",
      { projectId, isOverdue: true },
      { userId }
    );
    expect(overdueList.cards.map((c: any) => c.id)).toContain(pastCard.card!.id);
    expect(overdueList.cards.map((c: any) => c.id)).not.toContain(futureCard.card!.id);
    expect(overdueList.cards.map((c: any) => c.id)).not.toContain(noDueCard.card!.id);
  });

  it("filters cards by hasParent (root cards vs subtasks)", async () => {
    const parentCard = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Parent Root Task" },
      { userId }
    );
    const subCard = await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Subtask Item", parentId: parentCard.card!.id },
      { userId }
    );

    const rootOnly = await executeMcpTool(
      "list_cards",
      { projectId, hasParent: false },
      { userId }
    );
    expect(rootOnly.cards.some((c: any) => c.id === parentCard.card!.id)).toBe(true);
    expect(rootOnly.cards.some((c: any) => c.id === subCard.card!.id)).toBe(false);

    const subtasksOnly = await executeMcpTool(
      "list_cards",
      { projectId, hasParent: true },
      { userId }
    );
    expect(subtasksOnly.cards.some((c: any) => c.id === parentCard.card!.id)).toBe(false);
    expect(subtasksOnly.cards.some((c: any) => c.id === subCard.card!.id)).toBe(true);
  });

  it("filters by stateGroup alias", async () => {
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Unstarted Card" },
      { userId }
    );
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colDoneId, title: "Completed Card" },
      { userId }
    );

    const res = await executeMcpTool(
      "list_cards",
      { projectId, stateGroup: ["COMPLETED"] },
      { userId }
    );
    expect(res.cards.length).toBe(1);
    expect(res.cards[0].title).toBe("Completed Card");
  });

  it("supports orderBy and orderDirection", async () => {
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Task A", priority: "LOW", dueDate: "2026-03-01T00:00:00Z" },
      { userId }
    );
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Task B", priority: "URGENT", dueDate: "2026-01-01T00:00:00Z" },
      { userId }
    );

    const byDueDateAsc = await executeMcpTool(
      "list_cards",
      { projectId, orderBy: "due", orderDirection: "asc" },
      { userId }
    );
    expect(byDueDateAsc.cards[0].title).toBe("Task B");
    expect(byDueDateAsc.cards[1].title).toBe("Task A");

    const byDueDateDesc = await executeMcpTool(
      "list_cards",
      { projectId, orderBy: "due:desc" },
      { userId }
    );
    expect(byDueDateDesc.cards[0].title).toBe("Task A");
    expect(byDueDateDesc.cards[1].title).toBe("Task B");
  });

  it("counts cards via count_cards MCP tool and list_cards count: true", async () => {
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Task 1", priority: "HIGH", labelIds: [labelBugId] },
      { userId }
    );
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colTodoId, title: "Task 2", priority: "HIGH", labelIds: [labelFeatureId] },
      { userId }
    );
    await executeMcpTool(
      "create_card",
      { projectId, columnId: colDoneId, title: "Task 3", priority: "LOW" },
      { userId }
    );

    // Cheap count_cards tool
    const totalCount = await executeMcpTool(
      "count_cards",
      { projectId },
      { userId }
    );
    expect(totalCount.success).toBe(true);
    expect(totalCount.count).toBe(3);

    // Grouped by column
    const colGroupCount = await executeMcpTool(
      "count_cards",
      { projectId, groupBy: "column" },
      { userId }
    );
    expect(colGroupCount.groups.find((g: any) => g.columnId === colTodoId).count).toBe(2);
    expect(colGroupCount.groups.find((g: any) => g.columnId === colDoneId).count).toBe(1);

    // Grouped by priority
    const prioGroupCount = await executeMcpTool(
      "count_cards",
      { projectId, groupBy: "priority" },
      { userId }
    );
    expect(prioGroupCount.groups.find((g: any) => g.priority === "HIGH").count).toBe(2);
    expect(prioGroupCount.groups.find((g: any) => g.priority === "LOW").count).toBe(1);

    // Grouped by label
    const labelGroupCount = await executeMcpTool(
      "count_cards",
      { projectId, groupBy: "label" },
      { userId }
    );
    expect(labelGroupCount.groups.find((g: any) => g.labelId === labelBugId).count).toBe(1);
    expect(labelGroupCount.groups.find((g: any) => g.labelId === labelFeatureId).count).toBe(1);

    // list_cards with count: true
    const listCountRes = await executeMcpTool(
      "list_cards",
      { projectId, count: true, priority: "HIGH" },
      { userId }
    );
    expect(listCountRes.success).toBe(true);
    expect(listCountRes.count).toBe(2);
  });

  it("throws descriptive error for invalid orderBy or groupBy", async () => {
    await expect(
      executeMcpTool("list_cards", { projectId, orderBy: "invalid_column" }, { userId })
    ).rejects.toThrow(/Invalid orderBy/);

    await expect(
      executeMcpTool("count_cards", { projectId, groupBy: "invalid_group" }, { userId })
    ).rejects.toThrow(/Invalid groupBy/);

    await expect(
      executeMcpTool("list_cards", { projectId, dueBefore: "not-a-date" }, { userId })
    ).rejects.toThrow(/Invalid dueBefore date/);
  });
});
