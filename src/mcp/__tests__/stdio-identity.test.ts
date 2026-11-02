import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/mcp/core";
import { resolveStdioUser } from "@/mcp/stdioUser";
import { db } from "@/lib/db";
import { cleanupTestUser, createTestUser } from "@/test/helpers";

async function connect(options?: { userId?: string }) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(options);
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: () => client.close() };
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>) {
  return (result.content as { type: string; text: string }[])[0].text;
}

describe("stdio MCP identity", () => {
  let pinnedId: string;
  let otherId: string;
  let pinnedEmail: string;

  beforeEach(async () => {
    const pinned = await createTestUser(`stdio-pinned-${Date.now()}`);
    const other = await createTestUser(`stdio-other-${Date.now()}`);
    pinnedId = pinned.user.id;
    pinnedEmail = pinned.user.email;
    otherId = other.user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(pinnedId);
    await cleanupTestUser(otherId);
  });

  it("acts as the pinned user and ignores a userId argument from the client", async () => {
    const { client, close } = await connect({ userId: pinnedId });
    try {
      const result = await client.callTool({ name: "create_project", arguments: { name: "Pinned Project", userId: otherId } });
      expect(result.isError).toBeFalsy();
      const created = JSON.parse(resultText(result));

      const project = await db.project.findUnique({ where: { id: created.project.id } });
      expect(project!.userId).toBe(pinnedId);
    } finally {
      await close();
    }
  });

  it("without a pinned user, still takes the identity from the userId argument and requires one", async () => {
    const { client, close } = await connect();
    try {
      const missing = await client.callTool({ name: "list_projects", arguments: {} });
      expect(missing.isError).toBe(true);
      expect(resultText(missing)).toMatch(/userId is required/);

      const result = await client.callTool({ name: "create_project", arguments: { name: "Unpinned Project", userId: otherId } });
      const created = JSON.parse(resultText(result));
      expect((await db.project.findUnique({ where: { id: created.project.id } }))!.userId).toBe(otherId);
    } finally {
      await close();
    }
  });

  it("reads resources and prompts as the pinned user without a userId argument", async () => {
    const project = await db.project.create({ data: { name: "Pinned Resource", userId: pinnedId } });
    const { client, close } = await connect({ userId: pinnedId });
    try {
      const resource = await client.readResource({ uri: `opm://projects/${project.id}` });
      expect(JSON.parse((resource.contents[0] as { text: string }).text).id).toBe(project.id);

      const prompt = await client.getPrompt({ name: "summarize_project", arguments: { projectId: project.id } });
      expect(prompt.messages.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("resolves OPM_MCP_USER by email or id and rejects unknown values", async () => {
    expect(await resolveStdioUser(pinnedEmail.toUpperCase())).toEqual({ id: pinnedId, email: pinnedEmail });
    expect(await resolveStdioUser(pinnedId)).toEqual({ id: pinnedId, email: pinnedEmail });
    expect(await resolveStdioUser("nobody@example.com")).toBeNull();
    expect(await resolveStdioUser("   ")).toBeNull();
  });
});
