import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listRelations, POST as addRelation } from "../cards/[id]/relations/route";
import { DELETE as removeRelation } from "../cards/[id]/relations/[relationId]/route";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import { db } from "@/lib/db";

function request(token: string, method = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/cards/x/relations", {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const list = (token: string, id: string) => listRelations(request(token), { params: Promise.resolve({ id }) });
const add = (token: string, id: string, body: unknown) =>
  addRelation(request(token, "POST", body), { params: Promise.resolve({ id }) });
const remove = (token: string, id: string, relationId: string) =>
  removeRelation(request(token, "DELETE"), { params: Promise.resolve({ id, relationId }) });

// Refusals are asserted as "a client error and nothing changed" rather than one exact
// status: PR #319 (issue #271) changes these from 400 to 404 or 403.
async function expectRefused(res: Response) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect((await res.json()).success).not.toBe(true);
}

describe("card relation routes", () => {
  let owner: { id: string; token: string };
  let stranger: { id: string; token: string };
  let viewer: { id: string; token: string };
  let cardA: string;
  let cardB: string;

  beforeEach(async () => {
    const stamp = Date.now();
    const o = await createTestUser(`rel-owner-${stamp}`);
    const s = await createTestUser(`rel-stranger-${stamp}`);
    const v = await createTestUser(`rel-viewer-${stamp}`);
    owner = { id: o.user.id, token: o.token };
    stranger = { id: s.user.id, token: s.token };
    viewer = { id: v.user.id, token: v.token };

    const project = await createTestProject(owner.id, "Relations");
    await db.project.update({ where: { id: project.id }, data: { visibility: "PRIVATE" } });
    await db.projectMember.create({ data: { projectId: project.id, userId: viewer.id, role: "VIEWER" } });
    const columnId = (await db.column.create({ data: { projectId: project.id, name: "Todo", order: 1 } })).id;
    cardA = (await db.card.create({ data: { projectId: project.id, columnId, title: "A", number: 1, order: 1 } })).id;
    cardB = (await db.card.create({ data: { projectId: project.id, columnId, title: "B", number: 2, order: 2 } })).id;
  });

  afterEach(async () => {
    await cleanupTestUser(owner.id);
    await cleanupTestUser(stranger.id);
    await cleanupTestUser(viewer.id);
  });

  it("lets a member create, list and delete a relation", async () => {
    const created = await add(owner.token, cardA, { targetCardId: cardB, type: "blocks" });
    expect(created.status).toBe(201);
    const relation = (await created.json()).data;
    expect(relation).toMatchObject({ sourceCardId: cardA, targetCardId: cardB, type: "BLOCKS" });

    const listed = await list(owner.token, cardA);
    expect(listed.status).toBe(200);
    expect(JSON.stringify((await listed.json()).data)).toContain(relation.id);

    const deleted = await remove(owner.token, cardA, relation.id);
    expect(deleted.status).toBe(200);
    expect(await db.cardRelation.count({ where: { id: relation.id } })).toBe(0);
  });

  it("refuses a stranger on every relation route", async () => {
    const relation = await db.cardRelation.create({ data: { sourceCardId: cardA, targetCardId: cardB, type: "BLOCKS" } });

    await expectRefused(await list(stranger.token, cardA));
    await expectRefused(await add(stranger.token, cardB, { targetCardId: cardA, type: "RELATES_TO" }));
    await expectRefused(await remove(stranger.token, cardA, relation.id));

    expect(await db.cardRelation.count({ where: { OR: [{ sourceCardId: cardA }, { sourceCardId: cardB }] } })).toBe(1);
  });

  it("lets a Viewer list relations but not change them", async () => {
    const relation = await db.cardRelation.create({ data: { sourceCardId: cardA, targetCardId: cardB, type: "BLOCKS" } });

    expect((await list(viewer.token, cardA)).status).toBe(200);
    await expectRefused(await add(viewer.token, cardB, { targetCardId: cardA, type: "RELATES_TO" }));
    await expectRefused(await remove(viewer.token, cardA, relation.id));

    expect(await db.cardRelation.count({ where: { OR: [{ sourceCardId: cardA }, { sourceCardId: cardB }] } })).toBe(1);
  });

  it("rejects a self-relation, an unknown type and a missing target with 400", async () => {
    const self = await add(owner.token, cardA, { targetCardId: cardA });
    expect(self.status).toBe(400);
    expect((await self.json()).error).toBe("A card cannot relate to itself");

    const badType = await add(owner.token, cardA, { targetCardId: cardB, type: "DUPLICATES" });
    expect(badType.status).toBe(400);
    expect((await badType.json()).error).toMatch(/^Invalid relation type 'DUPLICATES'/);

    const noTarget = await add(owner.token, cardA, {});
    expect(noTarget.status).toBe(400);

    expect(await db.cardRelation.count({ where: { sourceCardId: cardA } })).toBe(0);
  });
});
