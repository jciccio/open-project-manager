import { MCP_TOOLS, executeMcpTool, createMcpServer } from "../src/mcp/core";
import { db } from "../src/lib/db";

async function runMcpTests() {
  console.log("🧪 Starting Automated MCP Integration Test Suite...\n");
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string) {
    totalCount++;
    if (condition) {
      console.log(`  ✓ PASSED: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAILED: ${testName}`);
    }
  }

  try {
    // Test 1: Tools schema validation
    console.log("▶ Testing MCP Tool Registration...");
    assert(Array.isArray(MCP_TOOLS) && MCP_TOOLS.length >= 15, "MCP_TOOLS array contains 15+ defined tools");
    const hasCreateCard = MCP_TOOLS.some((t) => t.name === "create_card");
    assert(hasCreateCard, "Tool 'create_card' is correctly registered");

    // Test 2: Server instance creation
    console.log("\n▶ Testing MCP Server Factory...");
    const server = createMcpServer();
    assert(!!server, "createMcpServer returns a valid Server instance");

    // Test 3: List Projects Tool
    console.log("\n▶ Testing Project & Card Operations via MCP Tool Handlers...");
    const listRes = await executeMcpTool("list_projects", { isArchived: false });
    assert(listRes.success && Array.isArray(listRes.projects), "list_projects tool execution");

    // Test 4: Create Project via MCP
    const testUser = await db.user.findFirst({ where: { email: "admin@example.com" } });
    if (!testUser) {
      throw new Error("No seeded admin@example.com user found — run `npx prisma db seed` first.");
    }
    const projRes = await executeMcpTool("create_project", {
      userId: testUser.id,
      name: `MCP Integration Test ${Date.now()}`,
      description: "Automated project created via MCP",
      color: "#10b981",
    });
    assert(projRes.success && !!projRes.project?.id, "create_project tool execution");
    const projectId = projRes.project!.id;

    // Test 5: List Columns via MCP
    const colRes = await executeMcpTool("list_columns", { projectId });
    assert(colRes.success && colRes.columns?.length === 4, "Default 4 Kanban columns created");
    const backlogCol = colRes.columns![0];
    const doneCol = colRes.columns![3];

    // Test 6: Create Task Card via MCP
    const cardRes = await executeMcpTool("create_card", {
      projectId,
      columnId: backlogCol.id,
      title: "Automated Card via MCP",
      description: "Testing card creation",
      priority: "HIGH",
      points: 8,
      owner: "MCP Agent",
    });
    assert(cardRes.success && cardRes.card?.points === 8, "create_card tool execution");
    const cardId = cardRes.card!.id;

    // Test 7: Move Card via MCP
    const moveRes = await executeMcpTool("move_card", {
      id: cardId,
      targetColumnId: doneCol.id,
      newOrder: 0,
    });
    assert(moveRes.success && moveRes.card?.columnId === doneCol.id, "move_card tool execution");

    // Test 8: Add Comment via MCP
    const commentRes = await executeMcpTool("add_comment", {
      cardId,
      author: "MCP Test Bot",
      content: "Task completed via MCP workflow",
    });
    assert(commentRes.success && commentRes.comment?.author === "MCP Test Bot", "add_comment tool execution");

    // Test 9: Cleanup Created Test Project
    const deleteRes = await executeMcpTool("delete_project", { id: projectId });
    assert(deleteRes.success && deleteRes.deletedId === projectId, "delete_project tool cleanup");

    console.log(`\n🎉 MCP Test Suite Completed: ${passedCount}/${totalCount} tests passed.\n`);
    if (passedCount !== totalCount) {
      process.exit(1);
    }
  } catch (error) {
    console.error("MCP test execution error:", error);
    process.exit(1);
  }
}

runMcpTests();
