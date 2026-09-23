import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestUser,
  createTestProject,
  createTestColumn,
  createTestCard,
  cleanupTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";
import * as cardsService from "@/lib/services/cards";

describe("addCardLink URL validation", () => {
  let userId: string;
  let cardId: string;

  beforeEach(async () => {
    const user = await createTestUser(`links-${Date.now()}`);
    userId = user.user.id;
    const project = await createTestProject(userId, "Links Project");
    const column = await createTestColumn(project.id);
    cardId = (await createTestCard(project.id, column.id)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it.each(["javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "not a url"])(
    "rejects %s and stores nothing",
    async (url) => {
      const res = await cardsService.addCardLink(cardId, url, "Click me", userId);
      expect(res.success).toBe(false);
      expect(await db.cardLink.count({ where: { cardId } })).toBe(0);
    }
  );

  it("stores an https link", async () => {
    const res = await cardsService.addCardLink(cardId, "https://example.com/docs", "Docs", userId);
    expect(res.success).toBe(true);
    expect(res.data?.url).toBe("https://example.com/docs");
  });
});
