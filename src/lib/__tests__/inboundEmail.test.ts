import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import {
  extractProjectKeyFromRecipient,
  extractSenderEmail,
  processInboundEmail,
} from "../inboundEmail";

describe("Inbound Email", () => {
  let ownerId: string;
  let memberId: string;
  let strangerId: string;
  let projectId: string;
  let projectKey: string;

  beforeEach(async () => {
    const ownerRes = await createTestUser(`inbound-owner-${Date.now()}`);
    ownerId = ownerRes.user.id;

    const memberRes = await createTestUser(`inbound-member-${Date.now()}`);
    memberId = memberRes.user.id;

    const strangerRes = await createTestUser(`inbound-stranger-${Date.now()}`);
    strangerId = strangerRes.user.id;

    const project = await createTestProject(ownerId, "Inbound Email Test Project");
    projectId = project.id;
    projectKey = project.key;

    // Create Backlog and Done columns
    await db.column.create({
      data: {
        projectId,
        name: "Backlog",
        group: "BACKLOG",
        order: 1,
      },
    });

    await db.column.create({
      data: {
        projectId,
        name: "Done",
        group: "COMPLETED",
        isDone: true,
        order: 2,
      },
    });

    // Add member to project
    await db.projectMember.create({
      data: {
        projectId,
        userId: memberId,
        role: "MEMBER",
      },
    });
  });

  afterEach(async () => {
    await cleanupTestUser(ownerId);
    await cleanupTestUser(memberId);
    await cleanupTestUser(strangerId);
  });

  describe("recipient and sender extractors", () => {
    it("extracts project key from varied recipient formats", () => {
      expect(extractProjectKeyFromRecipient("opm+FOO@opm.local")).toBe("FOO");
      expect(extractProjectKeyFromRecipient("task+BAR@example.com")).toBe("BAR");
      expect(extractProjectKeyFromRecipient("BAZ@inbound.domain.com")).toBe("BAZ");
      expect(extractProjectKeyFromRecipient("Team Board <opm+ALPHA@domain.com>")).toBe("ALPHA");
      expect(extractProjectKeyFromRecipient("invalid")).toBe("INVALID");
      expect(extractProjectKeyFromRecipient("")).toBeNull();
    });

    it("extracts clean email address from sender string", () => {
      expect(extractSenderEmail("user@example.com")).toBe("user@example.com");
      expect(extractSenderEmail("Alice Smith <ALICE@EXAMPLE.COM>")).toBe("alice@example.com");
      expect(extractSenderEmail("")).toBeNull();
    });
  });

  describe("processInboundEmail", () => {
    it("creates a card in the backlog column when sender is project owner", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Implement OAuth refresh",
        text: "Make sure refresh tokens rotate properly.",
      });

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(result.card?.title).toBe("Implement OAuth refresh");
      expect(result.card?.identifier).toBe(`${projectKey}-1`);

      const card = await db.card.findUnique({
        where: { id: result.card!.id },
        include: { column: true, activities: true },
      });
      expect(card).toBeDefined();
      expect(card?.column.group).toBe("BACKLOG");
      expect(card?.description).toBe("Make sure refresh tokens rotate properly.");
      expect(card?.activities.some((a) => a.type === "card_created")).toBe(true);
    });

    it("converts HTML email body to Markdown", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Card from rich HTML email",
        html: "<p>Hello <strong>team</strong>! Here is a <a href='https://example.com'>link</a>.</p>",
      });

      expect(result.success).toBe(true);
      const card = await db.card.findUnique({ where: { id: result.card!.id } });
      expect(card?.description).toContain("**team**");
      expect(card?.description).toContain("[link](https://example.com)");
    });

    it("allows a project member to create a card via inbound email", async () => {
      const member = await db.user.findUnique({ where: { id: memberId } });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: member!.email,
        subject: "Card created by member",
        text: "Member contribution.",
      });

      expect(result.success).toBe(true);
      expect(result.card?.title).toBe("Card created by member");
    });

    it("rejects an inbound email from a registered user who is not a project member", async () => {
      const stranger = await db.user.findUnique({ where: { id: strangerId } });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: stranger!.email,
        subject: "Spam card attempt",
        text: "Should be rejected.",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("is not a member of project");
    });

    it("rejects an inbound email from an unknown email address", async () => {
      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: "outsider@evil.com",
        subject: "External message",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("is not a registered user");
    });

    it("rejects when project key cannot be found", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const result = await processInboundEmail({
        to: `opm+NONEXISTENT@inbound.local`,
        from: owner!.email,
        subject: "Valid title",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project with key "NONEXISTENT" not found');
    });
  });
});
