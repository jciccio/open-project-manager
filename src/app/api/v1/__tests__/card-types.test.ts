import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCardTypesRoute, POST as createCardTypeRoute } from "../card-types/route";
import { PUT as updateCardTypeRoute, DELETE as deleteCardTypeRoute } from "../card-types/[id]/route";
import { NextRequest } from "next/server";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";

describe("REST API: Card Types", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-card-types-${Date.now()}`);
    userId = res.user.id;
    token = res.token;

    const project = await createTestProject(userId, "API Card Types Project");
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 401 without authorization", async () => {
    const req = new NextRequest(`http://localhost/api/v1/card-types?projectId=${projectId}`);
    const res = await getCardTypesRoute(req);
    expect(res.status).toBe(401);
  });

  it("requires projectId on GET", async () => {
    const req = new NextRequest("http://localhost/api/v1/card-types", {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await getCardTypesRoute(req);
    expect(res.status).toBe(400);
  });

  it("creates, lists, updates, and deletes a card type via REST API", async () => {
    const createReq = new NextRequest("http://localhost/api/v1/card-types", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Bug", icon: "Bug", color: "#ef4444", projectId }),
    });
    const createRes = await createCardTypeRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const cardTypeId = createBody.data.id;
    expect(createBody.data.name).toBe("Bug");

    const listReq = new NextRequest(`http://localhost/api/v1/card-types?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getCardTypesRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.some((ct: { id: string }) => ct.id === cardTypeId)).toBe(true);

    const updateReq = new NextRequest(`http://localhost/api/v1/card-types/${cardTypeId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Defect" }),
    });
    const updateRes = await updateCardTypeRoute(updateReq, { params: Promise.resolve({ id: cardTypeId }) });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.data.name).toBe("Defect");

    const delReq = new NextRequest(`http://localhost/api/v1/card-types/${cardTypeId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const delRes = await deleteCardTypeRoute(delReq, { params: Promise.resolve({ id: cardTypeId }) });
    expect(delRes.status).toBe(200);
  });
});
