import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT as updateProjectRoute } from "@/app/api/v1/projects/[id]/route";
import { db } from "@/lib/db";
import { verifyProjectAccess } from "@/lib/permissions";
import { executeMcpTool } from "@/mcp/core";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { createProject, updateProject } from "../projects";

describe("project visibility", () => {
  let ownerId: string;
  let ownerToken: string;
  let outsiderId: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    const owner = await createTestUser(`visibility-owner-${stamp}`);
    ownerId = owner.user.id;
    ownerToken = owner.token;
    outsiderId = (await createTestUser(`visibility-outsider-${stamp}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(outsiderId);
  });

  async function createInternalProject() {
    const res = await createProject({ name: "Shared", visibility: "INTERNAL" }, ownerId);
    return res.data!.id;
  }

  const storedVisibility = async (id: string) =>
    (await db.project.findUnique({ where: { id }, select: { visibility: true } }))?.visibility;

  it("stores a change to PRIVATE and removes a non-member's access", async () => {
    const id = await createInternalProject();
    expect(await verifyProjectAccess(id, outsiderId, "VIEWER")).toBe(true);

    const res = await updateProject(id, { visibility: "PRIVATE" }, ownerId);

    expect(res.success).toBe(true);
    expect(res.data?.visibility).toBe("PRIVATE");
    expect(await storedVisibility(id)).toBe("PRIVATE");
    expect(await verifyProjectAccess(id, outsiderId, "VIEWER")).toBe(false);
  });

  it("stores a change to INTERNAL and grants a non-member read access", async () => {
    const created = await createProject({ name: "Opening up" }, ownerId);
    const id = created.data!.id;
    expect(await verifyProjectAccess(id, outsiderId, "VIEWER")).toBe(false);

    await updateProject(id, { visibility: "INTERNAL" }, ownerId);

    expect(await verifyProjectAccess(id, outsiderId, "VIEWER")).toBe(true);
  });

  it("leaves visibility alone when an update doesn't mention it", async () => {
    const id = await createInternalProject();

    await updateProject(id, { name: "Renamed" }, ownerId);

    expect(await storedVisibility(id)).toBe("INTERNAL");
  });

  it("defaults to PRIVATE at create and rejects an unknown value without creating a project", async () => {
    const defaulted = await createProject({ name: "Default" }, ownerId);
    expect(defaulted.data?.visibility).toBe("PRIVATE");

    const before = await db.project.count({ where: { userId: ownerId } });
    const rejected = await createProject({ name: "Public", visibility: "PUBLIC" }, ownerId);

    expect(rejected.success).toBe(false);
    expect(await db.project.count({ where: { userId: ownerId } })).toBe(before);
  });

  it("rejects an unknown value at update and keeps the stored one", async () => {
    const id = await createInternalProject();

    const res = await updateProject(id, { visibility: "PUBLIC" }, ownerId);

    expect(res.success).toBe(false);
    expect(await storedVisibility(id)).toBe("INTERNAL");
  });

  it("refuses an ADMIN who isn't an owner", async () => {
    const id = await createInternalProject();
    await db.projectMember.create({ data: { projectId: id, userId: outsiderId, role: "ADMIN" } });

    const res = await updateProject(id, { visibility: "PRIVATE" }, outsiderId);

    expect(res.error).toBe("Only the project owner can change project visibility");
    expect(await storedVisibility(id)).toBe("INTERNAL");
  });

  it("applies through REST PUT /projects/:id", async () => {
    const id = await createInternalProject();
    const put = (visibility: string) =>
      updateProjectRoute(
        new NextRequest(`http://localhost/api/v1/projects/${id}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ visibility }),
        }),
        { params: Promise.resolve({ id }) }
      );

    expect((await put("PUBLIC")).status).toBe(400);
    expect(await storedVisibility(id)).toBe("INTERNAL");

    expect((await put("PRIVATE")).status).toBe(200);
    expect(await storedVisibility(id)).toBe("PRIVATE");
  });

  it("validates MCP create_project", async () => {
    const created = await executeMcpTool("create_project", { name: "Via MCP", visibility: "INTERNAL" }, { userId: ownerId });
    expect((created as any).project.visibility).toBe("INTERNAL");

    const defaulted = await executeMcpTool("create_project", { name: "Via MCP default" }, { userId: ownerId });
    expect((defaulted as any).project.visibility).toBe("PRIVATE");

    await expect(
      executeMcpTool("create_project", { name: "Via MCP public", visibility: "PUBLIC" }, { userId: ownerId })
    ).rejects.toThrow();
  });
});
