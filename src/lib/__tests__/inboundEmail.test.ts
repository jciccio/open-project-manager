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
      expect(extractSenderEmail("Attacker <attacker@evil.com> (<owner@corp.com>)")).toBe("attacker@evil.com");
      expect(extractSenderEmail('"<owner@corp.com>"@evil.com')).toBe('"<owner@corp.com>"@evil.com');
      expect(extractSenderEmail("<attacker@evil.com>, <owner@corp.com>")).toBeNull();
      expect(extractSenderEmail('"Smith, John" <john@example.com>')).toBe("john@example.com");
      expect(extractSenderEmail("")).toBeNull();
    });

    it("extracts project key resolving plus addresses and direct addresses across mailboxes", () => {
      expect(extractProjectKeyFromRecipient("bob+news@gmail.com, opm+PROJ@inbound.example.com")).toBe("PROJ");
      expect(extractProjectKeyFromRecipient("alice@x.com, PROJ@inbound.example.com")).toBe("PROJ");
      expect(extractProjectKeyFromRecipient('"Smith, John" <PROJ@inbound.example.com>')).toBe("PROJ");
    });

    it("skips malformed mailboxes without dropping remaining valid recipients", () => {
      expect(extractProjectKeyFromRecipient("Bob :) <bob@x.com>, opm+PROJ@inbound.example.com")).toBe("PROJ");
      expect(extractProjectKeyFromRecipient("Unbalanced (paren, PROJ@inbound.example.com")).toBe("PROJ");
    });

    it("strictly isolates matching to configured INBOUND_EMAIL_DOMAIN when set", () => {
      process.env.INBOUND_EMAIL_DOMAIN = "inbound.example.com";
      try {
        // Stray addresses on other domains are ignored even if they have task+/opm+ or direct keys
        expect(extractProjectKeyFromRecipient("task+personal@gmail.com, PROJ@inbound.example.com")).toBe("PROJ");
        expect(extractProjectKeyFromRecipient("ops@acme.com, bob+news@gmail.com")).toBeNull();
        expect(extractProjectKeyFromRecipient("PROJ+urgent@inbound.example.com")).toBe("PROJ");
        expect(extractProjectKeyFromRecipient("opm+OTHER@inbound.example.com")).toBe("OTHER");
      } finally {
        delete process.env.INBOUND_EMAIL_DOMAIN;
      }
    });

    it("does not match arbitrary domains or substring 'opm' in domains when INBOUND_EMAIL_DOMAIN is not set", () => {
      // bob@shopmail.com has 'opm' substring in domain, should NOT match
      expect(extractProjectKeyFromRecipient("bob@shopmail.com, PROJ@inbound.example.com")).toBe("PROJ");
      expect(extractProjectKeyFromRecipient("ops@acme.com")).toBeNull();
      expect(extractProjectKeyFromRecipient("bob+news@gmail.com")).toBeNull();
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

    it("creates card when sender has ADMIN role on project", async () => {
      const adminRes = await createTestUser(`inbound-admin-${Date.now()}`);
      await db.projectMember.create({
        data: {
          projectId,
          userId: adminRes.user.id,
          role: "ADMIN",
        },
      });

      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: adminRes.user.email,
        subject: "Admin created card",
      });

      expect(result.success).toBe(true);
      expect(result.card?.title).toBe("Admin created card");

      await cleanupTestUser(adminRes.user.id);
    });

    it("routes unambiguously when sender is VIEWER on one project and MEMBER on another with same key", async () => {
      // Create second project with same key where sender is VIEWER
      const viewerProject = await db.project.create({
        data: {
          userId: strangerId,
          name: "Viewer Project With Same Key",
          key: projectKey,
          color: "#0284c7",
        },
      });
      await db.column.create({
        data: {
          projectId: viewerProject.id,
          name: "Viewer Backlog",
          group: "BACKLOG",
          order: 1,
        },
      });
      await db.projectMember.create({
        data: {
          projectId: viewerProject.id,
          userId: memberId,
          role: "VIEWER",
        },
      });

      const member = await db.user.findUnique({ where: { id: memberId } });
      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: member!.email,
        subject: "Disambiguated member card",
      });

      expect(result.success).toBe(true);
      expect(result.card?.projectId).toBe(projectId);
    });

    it("rejects archived projects with matching key", async () => {
      await db.project.update({
        where: { id: projectId },
        data: { isArchived: true },
      });

      const owner = await db.user.findUnique({ where: { id: ownerId } });
      const result = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Card for archived project",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("project not found or sender unauthorized");
    });

    it("sets completedAt when card is placed in a done column", async () => {
      // Create project where all columns are completed
      const doneProject = await db.project.create({
        data: {
          userId: ownerId,
          name: "All Done Project",
          key: "ALLDONE",
          color: "#10b981",
        },
      });
      const doneCol = await db.column.create({
        data: {
          projectId: doneProject.id,
          name: "Completed",
          group: "COMPLETED",
          isDone: true,
          order: 1,
        },
      });

      const owner = await db.user.findUnique({ where: { id: ownerId } });
      const result = await processInboundEmail({
        to: `opm+ALLDONE@inbound.local`,
        from: owner!.email,
        subject: "Done card from email",
      });

      expect(result.success).toBe(true);
      const card = await db.card.findUnique({ where: { id: result.card!.id } });
      expect(card?.columnId).toBe(doneCol.id);
      expect(card?.completedAt).not.toBeNull();
    });

    it("falls back to Untitled Email when subject is empty and truncates when exceeding MAX_TITLE_LENGTH", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const resBlank = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "   ",
      });
      expect(resBlank.success).toBe(true);
      expect(resBlank.card?.title).toBe("Untitled Email");

      const longSubject = "A".repeat(600);
      const resLong = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: longSubject,
      });
      expect(resLong.success).toBe(true);
      expect(resLong.card?.title.length).toBeLessThanOrEqual(500);
    });

    it("prevents duplicate card creation when same delivery is retried", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const payload = {
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Idempotent card creation",
        text: "Relay delivery retry testing",
        messageId: "<unique-msg-id-123@example.com>",
      };

      const firstRes = await processInboundEmail(payload);
      expect(firstRes.success).toBe(true);
      expect(firstRes.duplicate).toBeUndefined();

      const secondRes = await processInboundEmail(payload);
      expect(secondRes.success).toBe(true);
      expect(secondRes.duplicate).toBe(true);
      expect(secondRes.card?.id).toBe(firstRes.card?.id);

      const count = await db.card.count({ where: { projectId, messageId: "<unique-msg-id-123@example.com>" } });
      expect(count).toBe(1);
    });

    it("extracts project key and routes email when destination address is in CC", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const res = await processInboundEmail({
        to: "alice@acme.com",
        cc: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Card routed via CC",
        text: "Target key was present in CC",
      });

      expect(res.success).toBe(true);
      expect(res.card?.title).toBe("Card routed via CC");
    });

    it("rejects payloads exceeding the body size limit", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const hugeText = "X".repeat(1024 * 1024 + 50);
      const res = await processInboundEmail({
        to: `opm+${projectKey}@inbound.local`,
        from: owner!.email,
        subject: "Oversized email",
        text: hugeText,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("body exceeds maximum size limit");
    });

    it("creates card using sessionUser without re-parsing from header", async () => {
      const owner = await db.user.findUnique({ where: { id: ownerId } });

      const res = await processInboundEmail(
        {
          to: `opm+${projectKey}@inbound.local`,
          from: "arbitrary-from-ignored",
          subject: "Card via sessionUser",
        },
        { id: owner!.id, email: owner!.email }
      );

      expect(res.success).toBe(true);
      expect(res.card?.title).toBe("Card via sessionUser");
    });
  });
});
