import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { GET as getViewsRoute, POST as createViewRoute } from "../views/route";
import { GET as getSingleViewRoute, PUT as updateViewRoute, DELETE as deleteViewRoute } from "../views/[id]/route";
import { NextRequest } from "next/server";

describe("REST API: Saved Views", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`api-view-user-${Date.now()}`);
    userId = userRes.user.id;
    token = userRes.token;

    const project = await createTestProject(userId, "REST Saved View Project");
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 401 without authorization", async () => {
    const req = new NextRequest("http://localhost/api/v1/views?projectId=foo");
    const res = await getViewsRoute(req);
    expect(res.status).toBe(401);
  });

  it("requires projectId on GET", async () => {
    const req = new NextRequest("http://localhost/api/v1/views", {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await getViewsRoute(req);
    expect(res.status).toBe(400);
  });

  it("creates, lists, gets, updates, and deletes a saved view via REST API", async () => {
    // 1. Create Saved View
    const createReq = new NextRequest("http://localhost/api/v1/views", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        name: "My API View",
        filterJson: { priority: "URGENT", query: "security" },
        isDefault: true,
      }),
    });
    const createRes = await createViewRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const viewId = createBody.data.id;
    expect(createBody.data.name).toBe("My API View");
    expect(createBody.data.isDefault).toBe(true);

    // 2. List Views
    const listReq = new NextRequest(`http://localhost/api/v1/views?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getViewsRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].id).toBe(viewId);

    // 3. Get Single View
    const getReq = new NextRequest(`http://localhost/api/v1/views/${viewId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getRes = await getSingleViewRoute(getReq, { params: Promise.resolve({ id: viewId }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.name).toBe("My API View");

    // 4. Update View
    const updateReq = new NextRequest(`http://localhost/api/v1/views/${viewId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated API View",
        isDefault: false,
      }),
    });
    const updateRes = await updateViewRoute(updateReq, { params: Promise.resolve({ id: viewId }) });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.data.name).toBe("Updated API View");
    expect(updateBody.data.isDefault).toBe(false);

    // 5. Delete View
    const deleteReq = new NextRequest(`http://localhost/api/v1/views/${viewId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteRes = await deleteViewRoute(deleteReq, { params: Promise.resolve({ id: viewId }) });
    expect(deleteRes.status).toBe(200);

    // Verify deletion
    const verifyListRes = await getViewsRoute(listReq);
    const verifyBody = await verifyListRes.json();
    expect(verifyBody.data.length).toBe(0);
  });
});
