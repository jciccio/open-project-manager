import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCardsRoute, POST as createCardRoute } from "../cards/route";
import { POST as reorderCardsRoute } from "../cards/reorder/route";
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

  it("supports limit and cursor pagination on GET /api/v1/cards", async () => {
    // Create 3 cards
    for (let i = 1; i <= 3; i++) {
      const createReq = new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          columnId,
          title: `Paginated Card ${i}`,
        }),
      });
      await createCardRoute(createReq);
    }

    // Page 1: limit=2
    const page1Req = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}&limit=2`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const page1Res = await getCardsRoute(page1Req);
    expect(page1Res.status).toBe(200);
    const page1Body = await page1Res.json();
    expect(page1Body.data.length).toBe(2);
    expect(page1Body.nextCursor).toBeDefined();
    expect(page1Body.nextCursor).not.toBeNull();

    // Page 2: limit=2 & cursor=page1Body.nextCursor
    const page2Req = new NextRequest(
      `http://localhost/api/v1/cards?projectId=${projectId}&limit=2&cursor=${page1Body.nextCursor}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const page2Res = await getCardsRoute(page2Req);
    expect(page2Res.status).toBe(200);
    const page2Body = await page2Res.json();
    expect(page2Body.data.length).toBe(1);
    expect(page2Body.data[0].title).toBe("Paginated Card 3");
    expect(page2Body.nextCursor).toBeNull();
  });

  it("filters by query across title and description on GET /api/v1/cards", async () => {
    const createOne = async (title: string, description?: string) => {
      const req = new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectId, columnId, title, description }),
      });
      return createCardRoute(req);
    };

    await createOne("Fix login bug", "Users can't sign in with SSO");
    await createOne("Update onboarding docs");
    await createOne("Refactor sidebar", "unrelated to login");

    // Matches by title substring, case-insensitive
    const titleReq = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}&query=LOGIN`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const titleRes = await getCardsRoute(titleReq);
    expect(titleRes.status).toBe(200);
    const titleBody = await titleRes.json();
    expect(titleBody.data.length).toBe(2);
    expect(titleBody.data.map((c: { title: string }) => c.title).sort()).toEqual(
      ["Fix login bug", "Refactor sidebar"].sort()
    );

    // Matches by description substring
    const descReq = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}&query=onboarding`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const descRes = await getCardsRoute(descReq);
    const descBody = await descRes.json();
    expect(descBody.data.length).toBe(1);
    expect(descBody.data[0].title).toBe("Update onboarding docs");

    // No match
    const noneReq = new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}&query=nonexistentterm`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const noneRes = await getCardsRoute(noneReq);
    const noneBody = await noneRes.json();
    expect(noneBody.data.length).toBe(0);
  });

  it("bulk reorders cards via POST /api/v1/cards/reorder", async () => {
    const req1 = new NextRequest("http://localhost/api/v1/cards", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId, columnId, title: "Card 1" }),
    });
    const res1 = await createCardRoute(req1);
    const card1 = (await res1.json()).data;

    const req2 = new NextRequest("http://localhost/api/v1/cards", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId, columnId, title: "Card 2" }),
    });
    const res2 = await createCardRoute(req2);
    const card2 = (await res2.json()).data;

    const reorderReq = new NextRequest("http://localhost/api/v1/cards/reorder", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: card1.id, order: 30000 },
          { id: card2.id, order: 5000 },
        ],
      }),
    });
    const reorderRes = await reorderCardsRoute(reorderReq);
    expect(reorderRes.status).toBe(200);
    const reorderBody = await reorderRes.json();
    expect(reorderBody.success).toBe(true);
  });
});
