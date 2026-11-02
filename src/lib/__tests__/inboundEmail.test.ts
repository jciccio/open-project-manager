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
      expect(extractProjectKeyFromRecipient("alice@x.com, opm+BETA@y.com")).toBe("BETA");
      expect(extractProjectKeyFromRecipient("invalid")).toBe("INVALID");
      expect(extractProjectKeyFromRecipient("")).toBeNull();
    });

    it("extracts clean email address from sender string and prevents display-name angle-bracket spoofing", () => {
      expect(extractSenderEmail("user@example.com")).toBe("user@example.com");
      expect(extractSenderEmail("Alice Smith <ALICE@EXAMPLE.COM>")).toBe("alice@example.com");
      expect(extractSenderEmail('"<owner@corp.com>" <attacker@evil.com>')).toBe("attacker@evil.com");
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
      expect(result.error).toContain("Inbound email rejected");
    });

    it("rejects an inbound email from an unknown email address", async () => {
      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: "outsider@evil.com",
        subject: "External message",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Inbound email rejected");
    });

    it("rejects when project key cannot be found", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const result = await processInboundEmail({
        to: `opm+NONEXISTENT@inbound.local`,
        from: owner!.email,
        subject: "Valid title",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Inbound email rejected");
    });

    it("rejects an inbound email from a user who only has VIEWER access", async () => {
      const viewerRes = await createTestUser(`inbound-viewer-${Date.now()}`);
      await db.projectMember.create({
        data: {
          projectId,
          userId: viewerRes.user.id,
          role: "VIEWER",
        },
      });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: viewerRes.user.email,
        subject: "Viewer attempt to create card",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Inbound email rejected");
      await cleanupTestUser(viewerRes.user.id);
    });

    it("disambiguates identical project keys across different owners", async () => {
      const ownerBRes = await createTestUser(`inbound-owner-b-${Date.now()}`);
      const projectB = await db.project.create({
        data: {
          userId: ownerBRes.user.id,
          name: "Project B Same Key",
          key: projectKey,
          color: "#3b82f6",
        },
      });
      await db.column.create({
        data: {
          projectId: projectB.id,
          name: "Backlog",
          group: "BACKLOG",
          order: 1,
        },
      });

      const resultB = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: ownerBRes.user.email,
        subject: "Card in Owner B project",
      });

      expect(resultB.success).toBe(true);
      expect(resultB.card?.projectId).toBe(projectB.id);
      expect(resultB.card?.projectId).not.toBe(projectId);

      await cleanupTestUser(ownerBRes.user.id);
    });

    it("strips script, style, head and title elements from HTML emails", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "HTML with styling and scripts",
        html: `<html><head><title>Ignore title</title><style>body { color: red; }</style><script>alert('bad');</script></head><body><p>Real content here</p></body></html>`,
      });

      expect(result.success).toBe(true);
      const card = await db.card.findUnique({ where: { id: result.card!.id } });
      expect(card?.description).toContain("Real content here");
      expect(card?.description).not.toContain("Ignore title");
      expect(card?.description).not.toContain("color: red");
      expect(card?.description).not.toContain("alert");
    });

    it("allocates next card number starting from maxCard + 1", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      // Create card with number 10
      await db.card.create({
        data: {
          projectId,
          columnId: (await db.column.findFirst({ where: { projectId } }))!.id,
          title: "Pre-existing card 10",
          number: 10,
          order: 1000,
        },
      });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "New sequential card",
        text: "Should be number 11",
      });

      expect(result.success).toBe(true);
      expect(result.card?.number).toBe(11);
      expect(result.card?.identifier).toBe(`${projectKey}-11`);
    });

    it("rejects when multiple accessible projects match key to prevent ambiguous routing", async () => {
      // A different owner creates a project with the same key, and memberId is a member of both
      const secondProject = await db.project.create({
        data: {
          userId: strangerId,
          name: "Conflicting Key Project",
          key: projectKey,
          color: "#e11d48",
        },
      });
      await db.projectMember.create({
        data: {
          projectId: secondProject.id,
          userId: memberId,
          role: "MEMBER",
        },
      });

      const member = await db.user.findUnique({ where: { id: memberId } });
      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: member!.email,
        subject: "Ambiguous card destination",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("multiple candidate projects found");
    });
  });
});
