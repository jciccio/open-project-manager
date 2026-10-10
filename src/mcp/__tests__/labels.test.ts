import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { executeMcpTool } from "../core";

describe("MCP create_label", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`mcp-labels-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("refuses a duplicate label name in the same project", async () => {
    const projRes = await executeMcpTool("create_project", { name: "MCP Label Project", userId });
    const projectId = projRes.project!.id;

    const first = await executeMcpTool("create_label", { name: "Blocked", projectId });
    expect(first.success).toBe(true);

    await expect(executeMcpTool("create_label", { name: "Blocked", projectId })).rejects.toThrow(
      "A label with this name already exists"
    );
    expect(await db.label.count({ where: { projectId, name: "Blocked" } })).toBe(1);
  });
});
