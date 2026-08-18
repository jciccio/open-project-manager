import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCardActivityRoute } from "../cards/[id]/activity/route";
import { GET as getActivityQueryRoute } from "../activity/route";
import { POST as createCardRoute } from "../cards/route";
import { NextRequest } from "next/server";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";

describe("REST API: Activity / Audit Trail", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let columnId: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-activity-${Date.now()}`);
    userId = res.user.id;
    token = res.token;

    const project = await createTestProject(userId, "Activity Test Project");
    projectId = project.id;

    const col = await createTestColumn(projectId, "To Do", 0);
    columnId = col.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("fetches card activity via /api/v1/cards/[id]/activity and /api/v1/activity?cardId=...", async () => {
    // 1. Create a card via REST
    const createReq = new NextRequest("http://localhost/api/v1/cards", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        columnId,
        title: "Card for Activity API Test",
      }),
    });
    const createRes = await createCardRoute(createReq);
    expect(createRes.status).toBe(201);
    const cardData = await createRes.json();
    const cardId = cardData.data.id;

    // 2. Fetch via /api/v1/cards/[id]/activity
    const actReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/activity`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const actRes = await getCardActivityRoute(actReq, {
      params: Promise.resolve({ id: cardId }),
    });
    expect(actRes.status).toBe(200);
    const actBody = await actRes.json();
    expect(actBody.success).toBe(true);
    expect(actBody.data.length).toBeGreaterThan(0);
    expect(actBody.data[0].type).toBe("card_created");

    // 3. Fetch via /api/v1/activity?cardId=xxx
    const queryReq = new NextRequest(`http://localhost/api/v1/activity?cardId=${cardId}`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const queryRes = await getActivityQueryRoute(queryReq);
    expect(queryRes.status).toBe(200);
    const queryBody = await queryRes.json();
    expect(queryBody.success).toBe(true);
    expect(queryBody.data.length).toBeGreaterThan(0);
  });

  it("returns 400 when cardId query parameter is missing on /api/v1/activity", async () => {
    const queryReq = new NextRequest("http://localhost/api/v1/activity", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const queryRes = await getActivityQueryRoute(queryReq);
    expect(queryRes.status).toBe(400);
  });
});
