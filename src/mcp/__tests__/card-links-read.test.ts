import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeMcpTool, readMcpResource } from "../core";
import { createTestUser, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

type ReadLink = { id: string; url: string; title: string | null };
type CardWithLinks = { links?: ReadLink[] };

describe("MCP card reads return card links", () => {
  let userId: string;
  let identifier: string;
  let cardId: string;
  let linkId: string;

  beforeEach(async () => {
    const res = await createTestUser(`mcp-card-links-${Date.now()}`);
    userId = res.user.id;

    const projRes = await executeMcpTool("create_project", { name: "Card Links Read" }, { userId });
    const project = projRes.project as unknown as { id: string; key: string; columns: { id: string }[] };

    const cardRes = await executeMcpTool(
      "create_card",
      { projectId: project.id, columnId: project.columns[0].id, title: "Card with an existing link" },
      { userId }
    );
    const card = cardRes.card as unknown as { id: string; number: number };
    cardId = card.id;
    identifier = `${project.key}-${card.number}`;

    const link = await db.cardLink.create({
      data: { cardId, url: "https://example.com/spec", title: "Spec" },
    });
    linkId = link.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  const expectedLink = () => ({ id: linkId, url: "https://example.com/spec", title: "Spec" });

  it("get_card returns the card's links", async () => {
    const res = await executeMcpTool("get_card", { id: cardId }, { userId });
    const links = (res.card as unknown as CardWithLinks).links;
    expect(links).toEqual([expect.objectContaining(expectedLink())]);
  });

  it("get_card_by_identifier returns the card's links", async () => {
    const res = await executeMcpTool("get_card_by_identifier", { identifier }, { userId });
    const links = (res.card as unknown as CardWithLinks).links;
    expect(links).toEqual([expect.objectContaining(expectedLink())]);
  });

  it("the opm://cards resource returns the card's links", async () => {
    const res = await readMcpResource(`opm://cards/${cardId}`, userId);
    const links = (res.data as unknown as CardWithLinks).links;
    expect(links).toEqual([expect.objectContaining(expectedLink())]);
  });

  it("removes a link using only an id read from get_card", async () => {
    const read = await executeMcpTool("get_card", { id: cardId }, { userId });
    const readLinkId = (read.card as unknown as CardWithLinks).links![0].id;

    const removed = await executeMcpTool("remove_card_link", { linkId: readLinkId }, { userId });
    expect(removed.success).toBe(true);
    expect(await db.cardLink.count({ where: { cardId } })).toBe(0);
  });
});
