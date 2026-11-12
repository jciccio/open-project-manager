import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { executeMcpTool } from "@/mcp/core";
import { getCardByIdentifier } from "@/lib/services/cards";
import { cleanupTestUser, createTestUser } from "@/test/helpers";
import { runImport } from "../runImport";
import type { Importer, ImportSummary } from "../types";

const KEY = "WWWWWWWWWWWW";

function importer(): Importer {
  return {
    name: "fake-long-keys",
    async *fetchProjects() {
      yield { sourceId: "p1", name: "Long key", key: KEY.toLowerCase() };
    },
    async *fetchColumns() {
      yield { sourceId: "c1", name: "To Do" };
    },
    async *fetchCardTypes() {},
    async *fetchLabels() {},
    async *fetchCards() {
      yield { sourceId: "card-1", columnSourceId: "c1", title: "Deep in the backlog", number: 12345 };
    },
    async *fetchComments() {},
  };
}

describe("importing a twelve-character project key", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`long-keys-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("stores the key as given and finds its cards by KEY-N", async () => {
    const summary = (await runImport(importer(), userId)) as ImportSummary;
    expect(summary.totals.failed).toBe(0);

    const project = await db.project.findFirstOrThrow({ where: { userId } });
    expect(project.key).toBe(KEY);

    const identifier = `${KEY}-12345`;
    const viaService = await getCardByIdentifier(identifier.toLowerCase(), userId);
    expect(viaService.success && viaService.data?.title).toBe("Deep in the backlog");

    const viaMcp = await executeMcpTool("get_card_by_identifier", { identifier }, { userId });
    expect(viaMcp.card?.title).toBe("Deep in the backlog");
  });
});
