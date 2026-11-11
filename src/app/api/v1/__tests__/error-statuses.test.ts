import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCard, PUT as putCard, DELETE as deleteCard } from "../cards/[id]/route";
import { PUT as putColumn } from "../columns/[id]/route";
import { POST as postComment } from "../cards/[id]/comments/route";
import { PATCH as patchComment } from "../comments/[id]/route";
import { GET as getMembers, POST as postMember } from "../projects/[id]/members/route";
import { GET as getByIdentifier } from "../cards/by-identifier/[identifier]/route";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import { db } from "@/lib/db";

const RAW_MESSAGE = "SQLITE_ERROR: secret table detail";

const accessDenial = vi.hoisted(() => vi.fn());

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  accessDenial.mockImplementation(actual.accessDenial);
  return { ...actual, accessDenial };
});

function call<P>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  token: string,
  params: P,
  method = "GET",
  body?: unknown
) {
  const req = new NextRequest("http://localhost/api/v1/test", {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(req, { params: Promise.resolve(params) });
}

describe("REST error statuses", () => {
  let owner: { id: string; token: string };
  let stranger: { id: string; token: string };
  let viewer: { id: string; token: string };
  let projectId: string;
  let projectKey: string;
  let columnId: string;
  let cardId: string;
  let commentId: string;

  beforeEach(async () => {
    const stamp = Date.now();
    const o = await createTestUser(`err-owner-${stamp}`);
    const s = await createTestUser(`err-stranger-${stamp}`);
    const v = await createTestUser(`err-viewer-${stamp}`);
    owner = { id: o.user.id, token: o.token };
    stranger = { id: s.user.id, token: s.token };
    viewer = { id: v.user.id, token: v.token };

    const project = await createTestProject(owner.id, "Error Statuses");
    projectId = project.id;
    projectKey = project.key;
    await db.project.update({ where: { id: projectId }, data: { visibility: "PRIVATE" } });
    await db.projectMember.create({ data: { projectId, userId: viewer.id, role: "VIEWER" } });
    columnId = (await db.column.create({ data: { projectId, name: "Todo", order: 1 } })).id;
    cardId = (await db.card.create({ data: { projectId, columnId, title: "Card", number: 1, order: 1 } })).id;
    commentId = (await db.comment.create({ data: { cardId, content: "Hi", author: "owner", authorUserId: owner.id } })).id;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUser(owner.id);
    await cleanupTestUser(stranger.id);
    await cleanupTestUser(viewer.id);
  });

  it("gives a stranger 404 on card, column, comment and member routes", async () => {
    const statuses = [
      (await call(putCard, stranger.token, { id: cardId }, "PUT", { title: "x" })).status,
      (await call(deleteCard, stranger.token, { id: cardId }, "DELETE")).status,
      (await call(putColumn, stranger.token, { id: columnId }, "PUT", { name: "x" })).status,
      (await call(postComment, stranger.token, { id: cardId }, "POST", { content: "x" })).status,
      (await call(patchComment, stranger.token, { id: commentId }, "PATCH", { content: "x" })).status,
      (await call(getMembers, stranger.token, { id: projectId })).status,
      (await call(postMember, stranger.token, { id: projectId }, "POST", { email: "a@b.invalid" })).status,
    ];

    expect(statuses).toEqual([404, 404, 404, 404, 404, 404, 404]);
  });

  it("gives a Viewer 403 for writes on card, column, comment and member routes", async () => {
    const statuses = [
      (await call(putCard, viewer.token, { id: cardId }, "PUT", { title: "x" })).status,
      (await call(deleteCard, viewer.token, { id: cardId }, "DELETE")).status,
      (await call(putColumn, viewer.token, { id: columnId }, "PUT", { name: "x" })).status,
      (await call(postComment, viewer.token, { id: cardId }, "POST", { content: "x" })).status,
      (await call(patchComment, viewer.token, { id: commentId }, "PATCH", { content: "x" })).status,
      (await call(postMember, viewer.token, { id: projectId }, "POST", { email: "a@b.invalid" })).status,
    ];

    expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
  });

  it("returns 404 for a missing card on GET, PUT and DELETE", async () => {
    const id = "does-not-exist";

    expect((await call(getCard, owner.token, { id })).status).toBe(404);
    expect((await call(putCard, owner.token, { id }, "PUT", { title: "x" })).status).toBe(404);
    expect((await call(deleteCard, owner.token, { id }, "DELETE")).status).toBe(404);
  });

  it("returns 400 with the formatted message for a zod validation failure", async () => {
    const res = await call(putCard, owner.token, { id: cardId }, "PUT", { title: 42 });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^title: /);
  });

  it("returns 500 without the raw exception text when a service throws", async () => {
    accessDenial.mockRejectedValueOnce(new Error(RAW_MESSAGE));

    const res = await call(putCard, owner.token, { id: cardId }, "PUT", { title: "x" });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to update card");
    expect(JSON.stringify(body)).not.toContain(RAW_MESSAGE);
  });

  it("returns 409 when adding someone who is already a member", async () => {
    const viewerEmail = (await db.user.findUniqueOrThrow({ where: { id: viewer.id } })).email;

    const res = await call(postMember, owner.token, { id: projectId }, "POST", { email: viewerEmail });

    expect(res.status).toBe(409);
  });

  it("uses the error kind, not the message, for card identifiers", async () => {
    expect((await call(getByIdentifier, owner.token, { identifier: `${projectKey}-999` })).status).toBe(404);
    expect((await call(getByIdentifier, owner.token, { identifier: "not an identifier" })).status).toBe(400);
  });
});
