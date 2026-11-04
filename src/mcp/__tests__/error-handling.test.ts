import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { POST as jsonrpcRoute } from "@/app/api/v1/mcp/jsonrpc/route";
import { POST as toolsRoute } from "@/app/api/v1/mcp/tools/route";
import { GET as resourcesRoute } from "@/app/api/v1/mcp/resources/route";
import { createMcpServer } from "../core";
import { INTERNAL_ERROR_MESSAGE, isPublicError } from "../errors";
import { cleanupTestUser, createTestUser } from "@/test/helpers";

describe("MCP HTTP and stdio error handling", () => {
  let userId: string;
  let token: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const res = await createTestUser(`mcp-errors-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleError.mockRestore();
    await cleanupTestUser(userId);
  });

  function rpc(body: unknown, raw = false) {
    return jsonrpcRoute(
      new NextRequest("http://localhost/api/v1/mcp/jsonrpc", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: raw ? (body as string) : JSON.stringify(body),
      })
    );
  }

  function callTool(name: string, args: unknown, id: unknown = 1) {
    return rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  }

  function restTool(body: unknown) {
    return toolsRoute(
      new NextRequest("http://localhost/api/v1/mcp/tools", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
    );
  }

  // A Prisma validation error (query shape, model names) and a TypeError (code path).
  const leakyCalls: [string, Record<string, unknown>, RegExp][] = [
    ["get_project", { id: { not: "x" } }, /findUnique|Argument|prisma/i],
    ["create_project", { name: 123 }, /trim|not a function/],
  ];

  describe("internal error text is not returned", () => {
    it.each(leakyCalls)("JSON-RPC tools/call %s", async (name, args, leak) => {
      const body = await (await callTool(name, args)).json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toBe(INTERNAL_ERROR_MESSAGE);
      expect(body.result.content[0].text).not.toMatch(leak);
      expect(consoleError).toHaveBeenCalled();
    });

    it.each(leakyCalls)("REST tools route %s", async (name, args, leak) => {
      const res = await restTool({ tool: name, arguments: args });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe(INTERNAL_ERROR_MESSAGE);
      expect(body.error).not.toMatch(leak);
    });

    it("keeps a tool's own error message, with a 400 on the REST route", async () => {
      const rpcBody = await (await callTool("get_project", { id: "missing" })).json();
      expect(rpcBody.result.content[0].text).toBe("Project with ID missing not found.");

      const res = await restTool({ tool: "get_project", arguments: { id: "missing" } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Project with ID missing not found.");
    });
  });

  it("treats a Node system error as internal even though it is a plain Error", () => {
    const fsError = Object.assign(new Error("ENOENT: no such file, open '/data/uploads/x'"), { code: "ENOENT" });
    expect(isPublicError(fsError)).toBe(false);
    expect(isPublicError(new Error("Card with ID x not found."))).toBe(true);
  });

  describe("JSON-RPC 2.0 envelope", () => {
    it("answers unparseable JSON with -32700 and a null id", async () => {
      const res = await rpc("{not json", true);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    });

    it("answers a request without a method with -32600 and echoes its id", async () => {
      const res = await rpc({ jsonrpc: "2.0", id: 7 });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.id).toBe(7);
      expect(body.error.code).toBe(-32600);
    });

    it("answers non-object arguments and unknown tools with -32602", async () => {
      const badArgs = await (await callTool("list_projects", "x", "a")).json();
      expect(badArgs).toMatchObject({ id: "a", error: { code: -32602 } });

      const unknown = await (await callTool("drop_database", {}, 3)).json();
      expect(unknown).toMatchObject({ id: 3, error: { code: -32602, message: "Unknown tool: drop_database" } });
      expect(unknown.result).toBeUndefined();
    });

    it("treats null arguments as no arguments", async () => {
      const body = await (await callTool("list_projects", null)).json();
      expect(body.result.isError).toBeUndefined();
    });

    it("always includes an id, null when the request's id is unusable", async () => {
      const body = await (await rpc({ jsonrpc: "2.0", id: { bad: true }, method: "tools/list" })).json();
      expect(body).toHaveProperty("id", null);
    });
  });

  describe("JSON-RPC batches", () => {
    it("answers each request in a batch and skips notifications", async () => {
      const res = await rpc([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "unknown/method" },
      ]);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe(1);
      expect(Array.isArray(body[0].result.tools)).toBe(true);
      expect(body[1]).toMatchObject({ id: 2, error: { code: -32601 } });
    });

    it("rejects an empty batch with a single -32600", async () => {
      const body = await (await rpc([])).json();
      expect(body).toMatchObject({ id: null, error: { code: -32600 } });
    });

    it("answers an all-notification batch with 202 and no body", async () => {
      const res = await rpc([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
      expect(res.status).toBe(202);
    });
  });

  describe("resource templates", () => {
    it("lists the per-project and per-card URI templates on JSON-RPC and REST", async () => {
      const body = await (await rpc({ jsonrpc: "2.0", id: 1, method: "resources/templates/list" })).json();
      const templates = body.result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate);
      expect(templates).toEqual(["opm://projects/{projectId}", "opm://cards/{cardId}"]);

      const rest = await (
        await resourcesRoute(
          new NextRequest("http://localhost/api/v1/mcp/resources", { headers: { authorization: `Bearer ${token}` } })
        )
      ).json();
      expect(rest.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate)).toEqual(templates);
    });
  });

  describe("stdio server", () => {
    async function connect() {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await createMcpServer({ userId }).connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);
      return client;
    }

    it("lists resource templates, rejects unknown tools as invalid params, and hides internal errors", async () => {
      const client = await connect();
      try {
        const { resourceTemplates } = await client.listResourceTemplates();
        expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("opm://cards/{cardId}");

        await expect(client.callTool({ name: "drop_database", arguments: {} })).rejects.toMatchObject({ code: -32602 });

        const leaked = await client.callTool({ name: "create_project", arguments: { name: 123 } });
        expect(leaked.isError).toBe(true);
        expect((leaked.content as { text: string }[])[0].text).toBe(
          `Error executing tool 'create_project': ${INTERNAL_ERROR_MESSAGE}`
        );
      } finally {
        await client.close();
      }
    });
  });
});
