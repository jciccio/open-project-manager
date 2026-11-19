import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listRelationsRoute } from "@/app/api/v1/cards/[id]/relations/route";
import { getCardRelations as getCardRelationsAction } from "@/actions/relations";
import { getProjectById, getProjectBoard } from "@/lib/services/projects";
import { executeMcpTool } from "@/mcp/core";
import { createSession, destroySession } from "@/lib/auth";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";
import { db } from "@/lib/db";

const HIDDEN_TITLE = "Secret card in project B";

async function cardIn(projectId: string, title: string, number: number) {
  const column = await db.column.create({ data: { projectId, name: `Col ${number}`, order: number } });
  return db.card.create({ data: { projectId, columnId: column.id, title, number, order: 1 } });
}

describe("relation reads across projects", () => {
  const suffix = Date.now();
  let owner: { id: string; token: string };
  let viewer: { id: string; email: string; name: string; token: string };
  let projectAId: string;
  let projectBKey: string;
  let cardAId: string;
  let sameProjectCardTitle: string;

  beforeEach(async () => {
    const o = await createTestUser(`rel-read-owner-${suffix}`);
    const v = await createTestUser(`rel-read-viewer-${suffix}`);
    owner = { id: o.user.id, token: o.token };
    viewer = { ...v.user, token: v.token };

    const projectA = await createTestProject(owner.id, "Shared Project A", "RSHA");
    const projectB = await createTestProject(owner.id, "Private Project B", "RPRB");
    projectAId = projectA.id;
    projectBKey = projectB.key;
    await db.projectMember.create({ data: { projectId: projectA.id, userId: viewer.id, role: "VIEWER" } });

    const cardA = await cardIn(projectA.id, "Card in project A", 1);
    sameProjectCardTitle = "Neighbour in project A";
    const neighbour = await cardIn(projectA.id, sameProjectCardTitle, 2);
    const cardB = await cardIn(projectB.id, HIDDEN_TITLE, 1);
    cardAId = cardA.id;

    await db.cardRelation.createMany({
      data: [
        { sourceCardId: cardA.id, targetCardId: cardB.id, type: "BLOCKS" },
        { sourceCardId: cardB.id, targetCardId: cardA.id, type: "RELATES_TO" },
        { sourceCardId: neighbour.id, targetCardId: cardA.id, type: "BLOCKS" },
      ],
    });
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(owner.id);
    await cleanupTestUser(viewer.id);
  });

  function expectNoProjectBData(payload: unknown) {
    const text = JSON.stringify(payload);
    expect(text).not.toContain(HIDDEN_TITLE);
    expect(text).not.toContain(`${projectBKey}-`);
  }

  it("hides the other project's card from the REST route", async () => {
    const res = await listRelationsRoute(
      new NextRequest(`http://localhost/api/v1/cards/${cardAId}/relations`, {
        headers: { authorization: `Bearer ${viewer.token}` },
      }),
      { params: Promise.resolve({ id: cardAId }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expectNoProjectBData(body);
    expect(body.data.map((r: { cardTitle: string }) => r.cardTitle)).toEqual([sameProjectCardTitle]);
  });

  it("hides the other project's card from the server action", async () => {
    await createSession({ userId: viewer.id, email: viewer.email, name: viewer.name });

    const res = await getCardRelationsAction(cardAId);

    expect(res.success).toBe(true);
    expectNoProjectBData(res);
  });

  it("hides the other project's card from MCP get_card_relations", async () => {
    const res = await executeMcpTool("get_card_relations", { cardId: cardAId }, { userId: viewer.id });

    expectNoProjectBData(res);
    expect(res.relations).toHaveLength(1);
  });

  it("hides the other project's card from the board load", async () => {
    const res = await getProjectById(projectAId, viewer.id);
    const boardRes = await getProjectBoard(projectAId, viewer.id);

    expect(res.success).toBe(true);
    expectNoProjectBData(res);
    expect(boardRes.success).toBe(true);
    expectNoProjectBData(boardRes);
  });

  it("still shows every relation to an account that can view both projects", async () => {
    const relations = await executeMcpTool("get_card_relations", { cardId: cardAId }, { userId: owner.id });
    const project = await getProjectById(projectAId, owner.id);
    const board = await getProjectBoard(projectAId, owner.id);

    expect(relations.relations).toHaveLength(3);
    const directions = relations.relations
      .filter((r: { cardTitle: string }) => r.cardTitle === HIDDEN_TITLE)
      .map((r: { direction: string }) => r.direction)
      .sort();
    expect(directions).toEqual(["incoming", "outgoing"]);
    expect(JSON.stringify(project)).toContain(HIDDEN_TITLE);
    expect(JSON.stringify(board)).toContain(HIDDEN_TITLE);
  });

  it("still reports a missing card as not found over MCP", async () => {
    await expect(
      executeMcpTool("get_card_relations", { cardId: "missing-card" }, { userId: viewer.id })
    ).rejects.toThrow("Card with ID missing-card not found.");
  });
});
