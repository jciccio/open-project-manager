import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getProjectsRoute, POST as createProjectRoute } from "../projects/route";
import { GET as getProjectByIdRoute, PUT as updateProjectRoute, DELETE as deleteProjectRoute } from "../projects/[id]/route";
import { POST as createColumnRoute } from "../projects/[id]/columns/route";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

describe("REST API: Projects and Columns", () => {
  let userId: string;
  let token: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-proj-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 401 when GET /api/v1/projects is called without authorization", async () => {
    const req = new NextRequest("http://localhost/api/v1/projects");
    const res = await getProjectsRoute(req);
    expect(res.status).toBe(401);
  });

  it("creates, retrieves, updates, and deletes projects via API", async () => {
    // 1. Create Project
    const createReq = new NextRequest("http://localhost/api/v1/projects", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "REST API Project", description: "Test Desc", color: "#3b82f6" }),
    });
    const createRes = await createProjectRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const projectId = createBody.data.id;

    // 2. Get All Projects
    const listReq = new NextRequest("http://localhost/api/v1/projects", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getProjectsRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBeGreaterThanOrEqual(1);

    // 3. Get Single Project
    const getReq = new NextRequest(`http://localhost/api/v1/projects/${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getRes = await getProjectByIdRoute(getReq, { params: Promise.resolve({ id: projectId }) });
    expect(getRes.status).toBe(200);

    // 4. Create Column in Project
    const colReq = new NextRequest(`http://localhost/api/v1/projects/${projectId}/columns`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Testing Column" }),
    });
    const colRes = await createColumnRoute(colReq, { params: Promise.resolve({ id: projectId }) });
    expect(colRes.status).toBe(201);

    // 5. Update Project
    const updateReq = new NextRequest(`http://localhost/api/v1/projects/${projectId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Updated REST Project" }),
    });
    const updateRes = await updateProjectRoute(updateReq, { params: Promise.resolve({ id: projectId }) });
    expect(updateRes.status).toBe(200);

    // 6. Delete Project
    const delReq = new NextRequest(`http://localhost/api/v1/projects/${projectId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const delRes = await deleteProjectRoute(delReq, { params: Promise.resolve({ id: projectId }) });
    expect(delRes.status).toBe(200);
  });
});
