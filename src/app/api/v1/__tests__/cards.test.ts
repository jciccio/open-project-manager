import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCardsRoute, POST as createCardRoute } from "../cards/route";
import { GET as getCardByIdRoute, PUT as updateCardRoute, DELETE as deleteCardRoute } from "../cards/[id]/route";
import { GET as getByIdentifierRoute } from "../cards/by-identifier/[identifier]/route";
import { NextRequest } from "next/server";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { getProjectById } from "@/actions/projects";

describe("REST API: Cards", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-cards-${Date.now()}`);
    userId = res.user.id;
    token = res.token;

    const project = await createTestProject(userId, "API Cards Project");
    projectId = project.id;

    const projectDetails = await getProjectById(projectId, userId);
    if (!projectDetails.data || projectDetails.data.columns.length === 0) {
      const { createTestColumn } = await import("@/test/helpers");
      const col = await createTestColumn(projectId, "To Do", 0);
      columnId = col.id;
    } else {
      columnId = projectDetails.data.columns[0].id;
    }
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("creates, fetches, updates, and deletes cards via REST API", async () => {
    // 1. Create Card
    const createReq = new NextRequest("http://localhost/api/v1/cards", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        columnId,
        title: "REST Card Test",
        description: "Created via REST API",
        priority: "HIGH",
        points: 5,
      }),
    });
    const createRes = await createCardRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const cardId = createBody.data.id;

    // 2. Get All Cards for Project
    const getListReq = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getListRes = await getCardsRoute(getListReq);
    expect(getListRes.status).toBe(200);
    const listBody = await getListRes.json();
    expect(listBody.data.length).toBeGreaterThanOrEqual(1);

    // 3. Get Card By ID
    const getSingleReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getSingleRes = await getCardByIdRoute(getSingleReq, { params: Promise.resolve({ id: cardId }) });
    expect(getSingleRes.status).toBe(200);

    // 4. Get Card By Identifier (ACP-1)
    const getByIdentifierReq = new NextRequest(`http://localhost/api/v1/cards/by-identifier/ACP-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getByIdentifierRes = await getByIdentifierRoute(getByIdentifierReq, {
      params: Promise.resolve({ identifier: "ACP-1" }),
    });
    expect(getByIdentifierRes.status).toBe(200);
    const byIdentifierBody = await getByIdentifierRes.json();
    expect(byIdentifierBody.data.identifier).toBe("ACP-1");
    expect(byIdentifierBody.data.title).toBe("REST Card Test");

    // 5. Update Card
    const updateReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Updated REST Card Title", priority: "URGENT" }),
    });
    const updateRes = await updateCardRoute(updateReq, { params: Promise.resolve({ id: cardId }) });
    expect(updateRes.status).toBe(200);

    // 6. Delete Card
    const delReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const delRes = await deleteCardRoute(delReq, { params: Promise.resolve({ id: cardId }) });
    expect(delRes.status).toBe(200);
  });
});

