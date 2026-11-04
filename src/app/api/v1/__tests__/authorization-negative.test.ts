import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProjectsRoute, POST as createProjectRoute } from "../projects/route";
import { GET as getProjectByIdRoute, PUT as updateProjectRoute, DELETE as deleteProjectRoute } from "../projects/[id]/route";
import { POST as createColumnRoute } from "../projects/[id]/columns/route";
import { GET as getCardsRoute, POST as createCardRoute } from "../cards/route";
import { GET as getCardByIdRoute, PUT as updateCardRoute, DELETE as deleteCardRoute } from "../cards/[id]/route";
import { GET as getActivityRoute } from "../activity/route";
import { GET as getCardActivityRoute } from "../cards/[id]/activity/route";
import { GET as getLabelsRoute, POST as createLabelRoute } from "../labels/route";
import { GET as getCardTypesRoute, POST as createCardTypeRoute } from "../card-types/route";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import { db } from "@/lib/db";

describe("Negative Authorization Test Suite", () => {
  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userAProjectId: string;
  let userAColumnId: string;
  let userACardId: string;

  beforeEach(async () => {
    const timestamp = Date.now();
    const uA = await createTestUser(`auth-neg-a-${timestamp}`);
    userA = { id: uA.user.id, token: uA.token };

    const uB = await createTestUser(`auth-neg-b-${timestamp}`);
    userB = { id: uB.user.id, token: uB.token };

    // Setup private project owned by User A with a column and card
    const proj = await createTestProject(userA.id, "User A Private Project");
    userAProjectId = proj.id;

    // Explicitly ensure visibility is PRIVATE
    await db.project.update({
      where: { id: userAProjectId },
      data: { visibility: "PRIVATE" },
    });

    const col = await db.column.create({
      data: {
        projectId: userAProjectId,
        name: "Todo",
        order: 1,
      },
    });
    userAColumnId = col.id;

    const card = await db.card.create({
      data: {
        projectId: userAProjectId,
        columnId: userAColumnId,
        title: "Confidential Card",
        number: 1,
        order: 1,
      },
    });
    userACardId = card.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userA.id);
    await cleanupTestUser(userB.id);
  });

  describe("1. Unauthenticated Requests (401 Unauthorized)", () => {
    it("rejects project routes without Bearer token", async () => {
      const getReq = new NextRequest("http://localhost/api/v1/projects");
      expect((await getProjectsRoute(getReq)).status).toBe(401);

      const postReq = new NextRequest("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Unauthenticated" }),
      });
      expect((await createProjectRoute(postReq)).status).toBe(401);

      const singleReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`);
      expect((await getProjectByIdRoute(singleReq, { params: Promise.resolve({ id: userAProjectId }) })).status).toBe(401);

      const putReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hacked" }),
      });
      expect((await updateProjectRoute(putReq, { params: Promise.resolve({ id: userAProjectId }) })).status).toBe(401);

      const delReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, { method: "DELETE" });
      expect((await deleteProjectRoute(delReq, { params: Promise.resolve({ id: userAProjectId }) })).status).toBe(401);
    });

    it("rejects card routes without Bearer token", async () => {
      const listReq = new NextRequest("http://localhost/api/v1/cards");
      expect((await getCardsRoute(listReq)).status).toBe(401);

      const postReq = new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Unauth card" }),
      });
      expect((await createCardRoute(postReq)).status).toBe(401);

      const getCardReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`);
      expect((await getCardByIdRoute(getCardReq, { params: Promise.resolve({ id: userACardId }) })).status).toBe(401);

      const putCardReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hacked card" }),
      });
      expect((await updateCardRoute(putCardReq, { params: Promise.resolve({ id: userACardId }) })).status).toBe(401);

      const delCardReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, { method: "DELETE" });
      expect((await deleteCardRoute(delCardReq, { params: Promise.resolve({ id: userACardId }) })).status).toBe(401);
    });

    it("rejects labels, card types, and activity routes without Bearer token", async () => {
      expect((await getLabelsRoute(new NextRequest("http://localhost/api/v1/labels"))).status).toBe(401);
      expect(
        (await createLabelRoute(
          new NextRequest("http://localhost/api/v1/labels", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Label" }),
          })
        )).status
      ).toBe(401);

      expect((await getCardTypesRoute(new NextRequest("http://localhost/api/v1/card-types"))).status).toBe(401);
      expect(
        (await createCardTypeRoute(
          new NextRequest("http://localhost/api/v1/card-types", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Type" }),
          })
        )).status
      ).toBe(401);

      expect((await getActivityRoute(new NextRequest("http://localhost/api/v1/activity"))).status).toBe(401);
      expect(
        (await getCardActivityRoute(new NextRequest(`http://localhost/api/v1/cards/${userACardId}/activity`), {
          params: Promise.resolve({ id: userACardId }),
        })).status
      ).toBe(401);
    });
  });

  describe("2. Invalid and Malformed Bearer Tokens (401 Unauthorized)", () => {
    it("rejects invalid Bearer tokens", async () => {
      const req = new NextRequest("http://localhost/api/v1/projects", {
        headers: { authorization: "Bearer totally-invalid-token" },
      });
      const res = await getProjectsRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeTruthy();
    });
  });

  describe("3. Cross-User Resource Isolation (User B accessing User A private project)", () => {
    it("returns 404 when User B queries User A's private project", async () => {
      const req = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const res = await getProjectByIdRoute(req, { params: Promise.resolve({ id: userAProjectId }) });
      expect(res.status).toBe(404);
    });

    it("rejects User B trying to update or delete User A's private project", async () => {
      const putReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Malicious Rename" }),
      });
      const putRes = await updateProjectRoute(putReq, { params: Promise.resolve({ id: userAProjectId }) });
      expect(putRes.status).toBe(400);

      const delReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const delRes = await deleteProjectRoute(delReq, { params: Promise.resolve({ id: userAProjectId }) });
      expect(delRes.status).toBe(400);
    });

    it("rejects User B trying to create a column in User A's private project", async () => {
      const req = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}/columns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Intruder Column" }),
      });
      const res = await createColumnRoute(req, { params: Promise.resolve({ id: userAProjectId }) });
      expect(res.status).toBe(400);
    });

    it("returns 404 when User B queries a card in User A's private project", async () => {
      const req = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const res = await getCardByIdRoute(req, { params: Promise.resolve({ id: userACardId }) });
      expect(res.status).toBe(404);
    });

    it("rejects User B trying to mutate or delete User A's card", async () => {
      const putReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Infiltrated Card Title" }),
      });
      const putRes = await updateCardRoute(putReq, { params: Promise.resolve({ id: userACardId }) });
      expect(putRes.status).toBe(400);

      const delReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const delRes = await deleteCardRoute(delReq, { params: Promise.resolve({ id: userACardId }) });
      expect(delRes.status).toBe(400);
    });

    it("rejects User B trying to create a card in User A's private column", async () => {
      const req = new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: userAProjectId,
          columnId: userAColumnId,
          title: "Intruder Task",
        }),
      });
      const res = await createCardRoute(req);
      expect(res.status).toBe(400);
    });
  });

  describe("4. Role-Based Permissions (VIEWER cannot mutate)", () => {
    beforeEach(async () => {
      // Add User B as VIEWER on User A's project
      await db.projectMember.create({
        data: {
          projectId: userAProjectId,
          userId: userB.id,
          role: "VIEWER",
        },
      });
    });

    it("allows VIEWER to read the project and card", async () => {
      const projReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const projRes = await getProjectByIdRoute(projReq, { params: Promise.resolve({ id: userAProjectId }) });
      expect(projRes.status).toBe(200);

      const cardReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const cardRes = await getCardByIdRoute(cardReq, { params: Promise.resolve({ id: userACardId }) });
      expect(cardRes.status).toBe(200);
    });

    it("disallows VIEWER from updating the project or creating columns", async () => {
      const putReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Viewer Attempted Rename" }),
      });
      const putRes = await updateProjectRoute(putReq, { params: Promise.resolve({ id: userAProjectId }) });
      expect(putRes.status).toBe(400);

      const colReq = new NextRequest(`http://localhost/api/v1/projects/${userAProjectId}/columns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Viewer Column" }),
      });
      const colRes = await createColumnRoute(colReq, { params: Promise.resolve({ id: userAProjectId }) });
      expect(colRes.status).toBe(400);
    });

    it("disallows VIEWER from creating, modifying, or deleting cards", async () => {
      const createReq = new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: userAProjectId,
          columnId: userAColumnId,
          title: "Viewer Task",
        }),
      });
      const createRes = await createCardRoute(createReq);
      expect(createRes.status).toBe(400);

      const updateReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${userB.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Viewer Card Edit" }),
      });
      const updateRes = await updateCardRoute(updateReq, { params: Promise.resolve({ id: userACardId }) });
      expect(updateRes.status).toBe(400);

      const delReq = new NextRequest(`http://localhost/api/v1/cards/${userACardId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userB.token}` },
      });
      const delRes = await deleteCardRoute(delReq, { params: Promise.resolve({ id: userACardId }) });
      expect(delRes.status).toBe(400);
    });
  });
});
