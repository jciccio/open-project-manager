import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCommentsRoute, POST as createCommentRoute } from "../cards/[id]/comments/route";
import { GET as getLabelsRoute, POST as createLabelRoute } from "../labels/route";
import { DELETE as deleteLabelRoute } from "../labels/[id]/route";
import { NextRequest } from "next/server";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { createCard } from "@/lib/services/cards";

describe("REST API: Comments and Labels", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let cardId: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-comments-labels-${Date.now()}`);
    userId = res.user.id;
    token = res.token;

    const project = await createTestProject(userId, "API Comments/Labels Project");
    projectId = project.id;
    const column = await createTestColumn(projectId, "To Do", 0);

    const cardRes = await createCard(
      { projectId, columnId: column.id, title: "Card for comments/labels" },
      userId
    );
    cardId = cardRes.data!.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("returns 401 without authorization", async () => {
    const commentsReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/comments`);
    const commentsRes = await getCommentsRoute(commentsReq, { params: Promise.resolve({ id: cardId }) });
    expect(commentsRes.status).toBe(401);

    const labelsReq = new NextRequest("http://localhost/api/v1/labels");
    const labelsRes = await getLabelsRoute(labelsReq);
    expect(labelsRes.status).toBe(401);
  });

  it("creates and lists comments on a card via REST API", async () => {
    const createReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/comments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ author: "REST Tester", content: "Hello from REST" }),
    });
    const createRes = await createCommentRoute(createReq, { params: Promise.resolve({ id: cardId }) });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.data.content).toBe("Hello from REST");

    const listReq = new NextRequest(`http://localhost/api/v1/cards/${cardId}/comments`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getCommentsRoute(listReq, { params: Promise.resolve({ id: cardId }) });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].content).toBe("Hello from REST");
  });

  it("creates, lists, and deletes project-scoped labels via REST API", async () => {
    const createReq = new NextRequest("http://localhost/api/v1/labels", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "REST Label", color: "#22c55e", projectId }),
    });
    const createRes = await createLabelRoute(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const labelId = createBody.data.id;
    expect(createBody.data.name).toBe("REST Label");

    const listReq = new NextRequest(`http://localhost/api/v1/labels?projectId=${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listRes = await getLabelsRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data.some((l: { id: string }) => l.id === labelId)).toBe(true);

    const delReq = new NextRequest(`http://localhost/api/v1/labels/${labelId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const delRes = await deleteLabelRoute(delReq, { params: Promise.resolve({ id: labelId }) });
    expect(delRes.status).toBe(200);
  });
});
