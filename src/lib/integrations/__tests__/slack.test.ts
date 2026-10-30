import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import {
  verifySlackSignature,
  formatCardUnfurl,
  formatEventNotification,
  handleSlackSlashCommand,
} from "../slack";

describe("Slack Integration", () => {
  let userId: string;
  let projectId: string;
  let projectKey: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`slack-user-${Date.now()}`);
    userId = userRes.user.id;

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

    it("creates a card via /opm new <title>", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: "new Implement Slack Notifications",
        user_name: "victor",
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Created card");
      expect(res.text).toContain("Implement Slack Notifications");

      const card = await db.card.findFirst({
        where: { title: "Implement Slack Notifications" },
      });
      expect(card?.title).toBe("Implement Slack Notifications");
      expect(card?.owner).toBe("Slack: @victor");
    });

    it("creates a card via /opm create <KEY> <title>", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Dedicated Key Card`,
        user_name: "jose",
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Dedicated Key Card");

      const card = await db.card.findFirst({
        where: { projectId, title: "Dedicated Key Card" },
      });
      expect(card).toBeDefined();
    });

    it("looks up a card via /opm get <KEY-1>", async () => {
      // First create a card
      await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Card To Look Up`,
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-1`,
      });

      expect(res.response_type).toBe("in_channel");
      expect(res.text).toContain("Card To Look Up");
      expect(res.blocks).toBeDefined();
    });

    it("returns ephemeral error when looking up non-existent card", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-999`,
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("was not found");
    });
  });
});
