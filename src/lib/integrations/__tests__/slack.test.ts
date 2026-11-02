import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import {
  verifySlackSignature,
  formatCardUnfurl,
  formatEventNotification,
  handleSlackSlashCommand,
  linkSlackUser,
  escapeSlackMrkdwn,
} from "../slack";

describe("Slack Integration", () => {
  let userId: string;
  let userToken: string;
  let projectId: string;
  let projectKey: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`slack-user-${Date.now()}`);
    userId = userRes.user.id;
    userToken = userRes.token;

    const project = await createTestProject(userId, "Slack App Test Project");
    projectId = project.id;
    projectKey = project.key;

    await db.column.create({
      data: {
        projectId,
        name: "Backlog",
        group: "BACKLOG",
        order: 1,
      },
    });

    await linkSlackUser("U_TEST_USER", userId);
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  describe("verifySlackSignature", () => {
    const secret = "slack_test_signing_secret_12345";
    const body = "command=%2Fopm&text=help";

    it("verifies a valid Slack HMAC signature", () => {
      const now = Math.floor(Date.now() / 1000);
      const timestamp = String(now);
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = `v0=${crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex")}`;

      const isValid = verifySlackSignature({
        signingSecret: secret,
        signature,
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(true);
    });

    it("rejects an expired timestamp (> 5 minutes old)", () => {
      const oldTime = Math.floor(Date.now() / 1000) - 350;
      const timestamp = String(oldTime);
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = `v0=${crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex")}`;

      const isValid = verifySlackSignature({
        signingSecret: secret,
        signature,
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(false);
    });

    it("rejects an invalid signature", () => {
      const now = Math.floor(Date.now() / 1000);
      const timestamp = String(now);

      const isValid = verifySlackSignature({
        signingSecret: secret,
        signature: "v0=invalid_hex_string_signature_attempt",
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(false);
    });
  });

  describe("formatters", () => {
    it("formats card unfurls with Block Kit", () => {
      const unfurl = formatCardUnfurl({
        identifier: "PROJ-42",
        title: "Test Card Title",
        status: "In Progress",
        priority: "HIGH",
        owner: "Alice",
        points: 5,
        url: "https://example.com/cards/42",
      });

      expect(unfurl.blocks.length).toBe(1);
      expect(unfurl.blocks[0].text?.text).toContain("PROJ-42: Test Card Title");
      expect(unfurl.blocks[0].fields?.some((f) => f.text.includes("In Progress"))).toBe(true);
      expect(unfurl.blocks[0].fields?.some((f) => f.text.includes("HIGH"))).toBe(true);
    });

    it("formats event notifications", () => {
      const notification = formatEventNotification("card_created", "Engine", {
        cardIdentifier: "ENG-1",
        cardTitle: "Refactor database",
        actorName: "Bob",
      });

      expect(notification.text).toContain("*Bob* created card");
      expect(notification.text).toContain("ENG-1");
    });
  });

  describe("handleSlackSlashCommand", () => {
    it("returns help text when empty or /opm help", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: "help",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("/opm new <title>");
    });

    it("requires Slack account to be linked before running actions", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: "new Unlinked Card",
        user_id: "U_UNLINKED",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Your Slack account is not linked to Open Project Manager");
    });

    it("links a Slack user via /opm link <api-token>", async () => {
      const user = await db.user.findUnique({ where: { id: userId } });
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${userToken}`,
        user_id: "U_NEW_LINK",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Successfully linked your Slack account");

      const who = await handleSlackSlashCommand({
        command: "/opm",
        text: "whoami",
        user_id: "U_NEW_LINK",
      });
      expect(who.text).toContain(user!.email);
    });

    it("rejects linking via bare email or invalid token", async () => {
      const user = await db.user.findUnique({ where: { id: userId } });
      const bareEmailRes = await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${user!.email}`,
        user_id: "U_ATTACKER",
      });
      expect(bareEmailRes.response_type).toBe("ephemeral");
      expect(bareEmailRes.text).toContain("Invalid or expired API token");

      const invalidTokenRes = await handleSlackSlashCommand({
        command: "/opm",
        text: "link not-a-real-jwt-token",
        user_id: "U_ATTACKER",
      });
      expect(invalidTokenRes.response_type).toBe("ephemeral");
      expect(invalidTokenRes.text).toContain("Invalid or expired API token");
    });

    it("replaces existing link on re-link avoiding duplicate mappings", async () => {
      const user2Res = await createTestUser(`slack-user2-${Date.now()}`);
      try {
        await handleSlackSlashCommand({
          command: "/opm",
          text: `link ${user2Res.token}`,
          user_id: "U_TEST_USER",
        });

        const count = await db.importRecord.count({
          where: {
            source: "slack",
            entityType: "user",
            sourceId: "U_TEST_USER",
          },
        });
        expect(count).toBe(1);

        const who = await handleSlackSlashCommand({
          command: "/opm",
          text: "whoami",
          user_id: "U_TEST_USER",
        });
        expect(who.text).toContain(user2Res.user.email);
      } finally {
        await cleanupTestUser(user2Res.user.id);
      }
    });

    it("rejects /opm create with no title", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey}`,
        user_id: "U_TEST_USER",
      });
      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Usage: `/opm create <KEY> <title>`");
    });

    it("creates a card via /opm new <title>", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: "new Implement Slack Notifications",
        user_id: "U_TEST_USER",
        user_name: "victor",
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Created card");
      expect(res.text).toContain("Implement Slack Notifications");

      const card = await db.card.findFirst({
        where: { title: "Implement Slack Notifications" },
      });
      expect(card?.title).toBe("Implement Slack Notifications");
      const user = await db.user.findUnique({ where: { id: userId } });
      expect(card?.owner).toBe(user?.name);
    });

    it("creates a card via /opm create <KEY> <title>", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Dedicated Key Card`,
        user_id: "U_TEST_USER",
        user_name: "jose",
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Dedicated Key Card");

      const card = await db.card.findFirst({
        where: { projectId, title: "Dedicated Key Card" },
      });
      expect(card).toBeDefined();
    });

    it("looks up a card ephemerally via /opm get <KEY-1>", async () => {
      // First create a card
      await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Card To Look Up`,
        user_id: "U_TEST_USER",
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-1`,
        user_id: "U_TEST_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Card To Look Up");
      expect(res.blocks).toBeDefined();
    });

    it("escapes Slack mrkdwn control characters in card titles", async () => {
      const maliciousTitle = "<!channel> <https://evil.com|click here> & fun";
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `new ${maliciousTitle}`,
        user_id: "U_TEST_USER",
      });

      expect(res.text).not.toContain("<!channel>");
      expect(res.text).toContain("&lt;!channel&gt;");
      expect(res.text).toContain("&amp; fun");
    });

    it("rejects card creation when user only has VIEWER role", async () => {
      const viewerRes = await createTestUser(`slack-viewer-${Date.now()}`);
      await db.projectMember.create({
        data: {
          projectId,
          userId: viewerRes.user.id,
          role: "VIEWER",
        },
      });
      await linkSlackUser("U_VIEWER", viewerRes.user.id);

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Viewer Attempt`,
        user_id: "U_VIEWER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("do not have permission to create cards");
      await cleanupTestUser(viewerRes.user.id);
    });

    it("disambiguates identical project keys across different owners", async () => {
      const ownerB = await createTestUser(`slack-owner-b-${Date.now()}`);
      const projectB = await db.project.create({
        data: {
          userId: ownerB.user.id,
          name: "Project B Same Key",
          key: projectKey, // Same key as Project A
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
      await linkSlackUser("U_OWNER_B", ownerB.user.id);

      // Owner B creates card with projectKey
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Card for Owner B`,
        user_id: "U_OWNER_B",
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Project B Same Key");

      const card = await db.card.findFirst({
        where: { title: "Card for Owner B" },
      });
      expect(card?.projectId).toBe(projectB.id);
      expect(card?.projectId).not.toBe(projectId);

      await cleanupTestUser(ownerB.user.id);
    });

    it("returns ephemeral error when looking up non-existent card", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-999`,
        user_id: "U_TEST_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("was not found");
    });
  });
});
