import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PUT as updateColumnRoute, DELETE as deleteColumnRoute } from "../columns/[id]/route";
import { DELETE as deleteCommentRoute } from "../comments/[id]/route";
import { POST as addCardLinkRoute } from "../cards/[id]/links/route";
import { DELETE as removeCardLinkRoute } from "../cards/[id]/links/[linkId]/route";
import { NextRequest } from "next/server";
import {
  createTestUser,
  createTestProject,
  createTestColumn,
  createTestCard,
  cleanupTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";

// Regression coverage for #93: each of these routes resolves the caller via
// getApiSession() but previously called its action without passing that
// session along, so the action silently fell back to cookie-only
// getSession() and a pure Bearer-token client (no cookie at all) got 401.
describe("REST API: Bearer-only clients reach routes that call the action with the resolved session", () => {
  let userId: string;
  let token: string;

  beforeEach(async () => {
    const { user, token: t } = await createTestUser(`api-bearer-session-${Date.now()}`);
    userId = user.id;
    token = t;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("updates and deletes a column via PUT/DELETE /api/v1/columns/:id", async () => {
    const project = await createTestProject(userId);
    const column = await createTestColumn(project.id);

    const putRes = await updateColumnRoute(
      new NextRequest(`http://localhost/api/v1/columns/${column.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed Column" }),
      }),
      { params: Promise.resolve({ id: column.id }) }
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.data.name).toBe("Renamed Column");

    const deleteRes = await deleteColumnRoute(
      new NextRequest(`http://localhost/api/v1/columns/${column.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: column.id }) }
    );
    expect(deleteRes.status).toBe(200);
  });

  it("deletes a comment via DELETE /api/v1/comments/:id", async () => {
    const project = await createTestProject(userId);
    const column = await createTestColumn(project.id);
    const card = await createTestCard(project.id, column.id);
    const comment = await db.comment.create({
      data: { cardId: card.id, author: "Test Author", content: "A comment" },
    });

    const res = await deleteCommentRoute(
      new NextRequest(`http://localhost/api/v1/comments/${comment.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: comment.id }) }
    );
    expect(res.status).toBe(200);
    expect(await db.comment.findUnique({ where: { id: comment.id } })).toBeNull();
  });

  it("adds and removes a card link via POST/DELETE /api/v1/cards/:id/links", async () => {
    const project = await createTestProject(userId);
    const column = await createTestColumn(project.id);
    const card = await createTestCard(project.id, column.id);

    const addRes = await addCardLinkRoute(
      new NextRequest(`http://localhost/api/v1/cards/${card.id}/links`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", title: "Example" }),
      }),
      { params: Promise.resolve({ id: card.id }) }
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json();
    expect(addBody.data.url).toBe("https://example.com");

    const removeRes = await removeCardLinkRoute(
      new NextRequest(`http://localhost/api/v1/cards/${card.id}/links/${addBody.data.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: card.id, linkId: addBody.data.id }) }
    );
    // No Authorization header and no cookie on this second request — proves
    // it's actually unauthenticated, not just missing a session check.
    expect(removeRes.status).toBe(401);

    const removeAuthedRes = await removeCardLinkRoute(
      new NextRequest(`http://localhost/api/v1/cards/${card.id}/links/${addBody.data.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: card.id, linkId: addBody.data.id }) }
    );
    expect(removeAuthedRes.status).toBe(200);
  });
});
