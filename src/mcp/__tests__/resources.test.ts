import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readMcpResource, executeMcpTool } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { GET as getResourceRoute } from "@/app/api/v1/mcp/resources/route";
import { POST as jsonrpcRoute } from "@/app/api/v1/mcp/jsonrpc/route";

describe("MCP resources: cross-user ownership enforcement", () => {
  let ownerId: string;
  let ownerToken: string;
  let intruderId: string;
  let projectId: string;
  let columnId: string;
  let cardId: string;

  beforeEach(async () => {
    const owner = await createTestUser(`mcp-res-owner-${Date.now()}`);
    ownerId = owner.user.id;
    ownerToken = owner.token;
    const intruder = await createTestUser(`mcp-res-intruder-${Date.now()}`);
    intruderId = intruder.user.id;

    const projRes = await executeMcpTool("create_project", { name: "Owner Project" }, { userId: ownerId });
    projectId = projRes.project!.id;
    columnId = (projRes.project as any).columns[0].id;

    const cardRes = await executeMcpTool(
      "create_card",
      { projectId, columnId, title: "Owner Card" },
      { userId: ownerId }
    );
    cardId = cardRes.card!.id;
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(intruderId);
  });

  describe("readMcpResource (shared helper)", () => {
    it("scopes opm://projects to the caller", async () => {
      const ownerList = await readMcpResource("opm://projects", ownerId);
      expect((ownerList.data as { id: string }[]).some((p) => p.id === projectId)).toBe(true);

      const intruderList = await readMcpResource("opm://projects", intruderId);
      expect((intruderList.data as { id: string }[]).some((p) => p.id === projectId)).toBe(false);
    });

    it("rejects a non-owner reading opm://projects/<id>", async () => {
      const owned = await readMcpResource(`opm://projects/${projectId}`, ownerId);
      expect((owned.data as { id: string }).id).toBe(projectId);

      await expect(readMcpResource(`opm://projects/${projectId}`, intruderId)).rejects.toThrow("not found");
    });

    it("rejects a non-owner reading opm://cards/<id>", async () => {
      const owned = await readMcpResource(`opm://cards/${cardId}`, ownerId);
      expect((owned.data as { id: string }).id).toBe(cardId);

      await expect(readMcpResource(`opm://cards/${cardId}`, intruderId)).rejects.toThrow("not found");
    });
  });

  describe("REST resources route", () => {
    it("requires authorization", async () => {
      const req = new NextRequest(`http://localhost/api/v1/mcp/resources?uri=opm://projects`);
      const res = await getResourceRoute(req);
      expect(res.status).toBe(401);
    });

    it("scopes results to the authenticated caller and 404s on another user's project", async () => {
      const listReq = new NextRequest(`http://localhost/api/v1/mcp/resources?uri=opm://projects`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      const listRes = await getResourceRoute(listReq);
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.data.some((p: { id: string }) => p.id === projectId)).toBe(true);

      const intruderToken = (await createTestUser(`mcp-res-intruder2-${Date.now()}`)).token;
      const projectReq = new NextRequest(`http://localhost/api/v1/mcp/resources?uri=opm://projects/${projectId}`, {
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      const projectRes = await getResourceRoute(projectReq);
      expect(projectRes.status).toBe(404);
    });
  });

  describe("JSON-RPC resources/read", () => {
    it("requires authorization", async () => {
      const req = new NextRequest("http://localhost/api/v1/mcp/jsonrpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "opm://projects" },
        }),
      });
      const res = await jsonrpcRoute(req);
      expect(res.status).toBe(401);
    });

    it("scopes opm://projects to the authenticated caller", async () => {
      const req = new NextRequest("http://localhost/api/v1/mcp/jsonrpc", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "opm://projects" },
        }),
      });
      const res = await jsonrpcRoute(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      const projects = JSON.parse(body.result.contents[0].text);
      expect(projects.some((p: { id: string }) => p.id === projectId)).toBe(true);
    });
  });
});
