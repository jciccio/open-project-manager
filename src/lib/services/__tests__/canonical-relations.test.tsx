import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { normalizeRelation } from "@/lib/cardRelations";
import { addCardRelation, getCardRelations } from "@/lib/services/relations";
import { addCardRelation as addCardRelationAction } from "@/actions/relations";
import { getProjectById } from "@/actions/projects";
import { POST as addRelationRoute } from "@/app/api/v1/cards/[id]/relations/route";
import { executeMcpTool } from "@/mcp/core";
import TaskCard from "@/components/TaskCard";
import { LanguageProvider } from "@/components/LanguageProvider";
import { cleanupTestUser, createTestProject, createTestUser } from "@/test/helpers";

type BoardCard = ComponentProps<typeof TaskCard>["card"];

describe("card relations are stored in one canonical form", () => {
  let user: { id: string; email: string; name: string };
  let token: string;
  let projectKey: string;
  let cardA: string;
  let cardB: string;

  beforeEach(async () => {
    const created = await createTestUser(`canonical-rel-${Date.now()}`);
    user = created.user;
    token = created.token;
    const project = await createTestProject(user.id, "Canonical Relations");
    projectKey = project.key;
    const columnId = (await db.column.create({ data: { projectId: project.id, name: "Todo", order: 1 } })).id;
    cardA = (await db.card.create({ data: { projectId: project.id, columnId, title: "A", number: 1, order: 1 } })).id;
    cardB = (await db.card.create({ data: { projectId: project.id, columnId, title: "B", number: 2, order: 2 } })).id;
  });

  afterEach(async () => {
    await destroySession();
    await cleanupTestUser(user.id);
  });

  const storedRows = () =>
    db.cardRelation.findMany({
      where: { OR: [{ sourceCardId: { in: [cardA, cardB] } }, { targetCardId: { in: [cardA, cardB] } }] },
      select: { sourceCardId: true, targetCardId: true, type: true },
    });

  const blockedBy: Array<[string, () => Promise<unknown>]> = [
    ["the service", () => addCardRelation(cardA, cardB, "BLOCKED_BY", user.id)],
    [
      "REST",
      () =>
        addRelationRoute(
          new NextRequest("http://localhost/api/v1/cards/x/relations", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ targetCardId: cardB, type: "BLOCKED_BY" }),
          }),
          { params: Promise.resolve({ id: cardA }) }
        ),
    ],
    [
      "the UI action",
      async () => {
        await createSession({ userId: user.id, email: user.email, name: user.name });
        return addCardRelationAction(cardA, cardB, "BLOCKED_BY");
      },
    ],
    [
      "MCP",
      () => executeMcpTool("add_card_relation", { sourceCardId: cardA, targetCardId: cardB, type: "BLOCKED_BY" }, { userId: user.id }),
    ],
  ];

  it.each(blockedBy)("stores 'A BLOCKED_BY B' through %s as one (B, A, BLOCKS) row", async (_, add) => {
    await add();
    expect(await storedRows()).toEqual([{ sourceCardId: cardB, targetCardId: cardA, type: "BLOCKS" }]);
  });

  it("creates no second row for the inverse of a blocking relation", async () => {
    await addCardRelation(cardB, cardA, "BLOCKS", user.id);
    const again = await addCardRelation(cardA, cardB, "BLOCKED_BY", user.id);

    expect(again.success).toBe(true);
    expect(await storedRows()).toEqual([{ sourceCardId: cardB, targetCardId: cardA, type: "BLOCKS" }]);
  });

  it("creates no second row for RELATES_TO added from either card", async () => {
    await addCardRelation(cardA, cardB, "RELATES_TO", user.id);
    await addCardRelation(cardB, cardA, "RELATES_TO", user.id);

    const expected = normalizeRelation(cardA, cardB, "RELATES_TO");
    if (!expected.valid) throw new Error(expected.error);
    expect(await storedRows()).toEqual([
      { sourceCardId: expected.sourceId, targetCardId: expected.targetId, type: "RELATES_TO" },
    ]);
  });

  it("reads a blocking relation the same way from both cards", async () => {
    await addCardRelation(cardA, cardB, "BLOCKED_BY", user.id);

    const fromA = await getCardRelations(cardA, user.id);
    const fromB = await getCardRelations(cardB, user.id);
    expect(fromA.data!.map((r) => [r.relationType, r.cardId])).toEqual([["BLOCKED_BY", cardB]]);
    expect(fromB.data!.map((r) => [r.relationType, r.cardId])).toEqual([["BLOCKS", cardA]]);
  });

  it("shows A as blocked by B on the board after 'A BLOCKED_BY B' in the card modal", async () => {
    await createSession({ userId: user.id, email: user.email, name: user.name });
    await addCardRelationAction(cardA, cardB, "BLOCKED_BY");

    const board = await getProjectById((await db.card.findUniqueOrThrow({ where: { id: cardA } })).projectId);
    const boardCard = board.data!.columns.flatMap((column) => column.cards).find((card) => card.id === cardA);

    render(
      <LanguageProvider>
        <TaskCard card={boardCard as unknown as BoardCard} onClick={() => {}} />
      </LanguageProvider>
    );
    expect(screen.getByText(`Blocked (${projectKey}-2)`)).toBeTruthy();
  });

  it("lets a caller remove through MCP a 'blocked by' they added on a card in a project they only view", async () => {
    const other = await createTestUser(`canonical-rel-other-${Date.now()}`);
    try {
      const otherProject = await createTestProject(other.user.id, "Viewed Project");
      await db.projectMember.create({ data: { projectId: otherProject.id, userId: user.id, role: "VIEWER" } });
      const otherColumn = await db.column.create({ data: { projectId: otherProject.id, name: "Todo" } });
      const viewedCard = await db.card.create({
        data: { projectId: otherProject.id, columnId: otherColumn.id, title: "Viewed", number: 1 },
      });

      const added = await executeMcpTool(
        "add_card_relation",
        { sourceCardId: cardA, targetCardId: viewedCard.id, type: "BLOCKED_BY" },
        { userId: user.id }
      );
      expect(added.relation).toMatchObject({ sourceCardId: viewedCard.id, targetCardId: cardA, type: "BLOCKS" });

      const removed = await executeMcpTool("remove_card_relation", { relationId: added.relation!.id }, { userId: user.id });
      expect(removed.success).toBe(true);
      expect(await db.cardRelation.count({ where: { id: added.relation!.id } })).toBe(0);
    } finally {
      await cleanupTestUser(other.user.id);
    }
  });

  it("MCP rejects an unknown type and a self-relation with the service's messages", async () => {
    await expect(
      executeMcpTool("add_card_relation", { sourceCardId: cardA, targetCardId: cardB, type: "blocking" }, { userId: user.id })
    ).rejects.toThrow("Invalid relation type 'blocking'. Expected BLOCKS, BLOCKED_BY, or RELATES_TO");
    await expect(
      executeMcpTool("add_card_relation", { sourceCardId: cardA, targetCardId: cardA }, { userId: user.id })
    ).rejects.toThrow("A card cannot relate to itself");
    expect(await storedRows()).toEqual([]);
  });
});
