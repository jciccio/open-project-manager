import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { signApiToken } from "@/lib/auth";
import { revokeUserAccess } from "@/lib/revokeUser";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import {
  verifySlackSignature,
  formatCardUnfurl,
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

    const apiRow = await db.apiToken.create({
      data: {
        userId,
        name: "Test API Token",
      },
    });
    userToken = await signApiToken(
      { userId, email: userRes.user.email, name: userRes.user.name, tokenVersion: userRes.user.tokenVersion },
      apiRow.id
    );

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

    await linkSlackUser("U_TEST_USER", userId, apiRow.id);
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

    it("links a Slack user via /opm link with a real API token", async () => {
      const user = await db.user.findUnique({ where: { id: userId } });
      const apiTokenRow = await db.apiToken.create({
        data: { userId, name: "Slack Link Token" },
      });
      const realApiToken = await signApiToken(
        { userId, email: user!.email, name: user!.name, tokenVersion: user!.tokenVersion },
        apiTokenRow.id
      );

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${realApiToken}`,
        user_id: "U_REAL_API_TOKEN_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Successfully linked your Slack account");

      const who = await handleSlackSlashCommand({
        command: "/opm",
        text: "whoami",
        user_id: "U_REAL_API_TOKEN_USER",
      });
      expect(who.text).toContain(user!.email);
    });

    it("rejects linking via bare email, forged token, or token with invalid signature", async () => {
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

      // Forged JWT signed with a different key
      const forgedSecret = new TextEncoder().encode("wrong-secret-key-forged-test-12345678");
      const forgedToken = await new SignJWT({
        userId,
        email: user!.email,
        name: user!.name,
        tv: user!.tokenVersion,
        aud: "opm:session",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(forgedSecret);

      const forgedRes = await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${forgedToken}`,
        user_id: "U_ATTACKER",
      });
      expect(forgedRes.response_type).toBe("ephemeral");
      expect(forgedRes.text).toContain("Invalid or expired API token");
    });

    it("rejects token when user's tokenVersion was incremented (revoked)", async () => {
      // User creates token, then tokenVersion is incremented
      await db.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${userToken}`,
        user_id: "U_STALE_TV_USER",
      });
      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Invalid or expired API token");
    });

    it("ends Slack actions and severs link when revokeUserAccess is called", async () => {
      await handleSlackSlashCommand({
        command: "/opm",
        text: `link ${userToken}`,
        user_id: "U_REVOKE_TARGET",
      });
      await linkSlackUser("U_REVOKE_STANDALONE", userId);

      const whoBefore = await handleSlackSlashCommand({
        command: "/opm",
        text: "whoami",
        user_id: "U_REVOKE_TARGET",
      });
      expect(whoBefore.text).toContain("You are linked as");

      await revokeUserAccess(userId);

      // Verify ImportRecord rows themselves are deleted (not merely failing because ApiToken is gone)
      expect(
        await db.importRecord.count({
          where: {
            source: "slack",
            entityType: "user",
            sourceId: { in: ["U_REVOKE_TARGET", "U_REVOKE_STANDALONE"] },
          },
        })
      ).toBe(0);

      const whoAfter = await handleSlackSlashCommand({
        command: "/opm",
        text: "whoami",
        user_id: "U_REVOKE_TARGET",
      });
      expect(whoAfter.text).toContain("Your Slack account is not linked");

      const standaloneAfter = await handleSlackSlashCommand({
        command: "/opm",
        text: "whoami",
        user_id: "U_REVOKE_STANDALONE",
      });
      expect(standaloneAfter.text).toContain("Your Slack account is not linked");
    });

    it("replaces existing link on re-link avoiding duplicate mappings", async () => {
      const user2Res = await createTestUser(`slack-user2-${Date.now()}`);
      try {
        const apiRow2 = await db.apiToken.create({
          data: {
            userId: user2Res.user.id,
            name: "Test API Token 2",
          },
        });
        const user2ApiToken = await signApiToken(
          { userId: user2Res.user.id, email: user2Res.user.email, name: user2Res.user.name, tokenVersion: user2Res.user.tokenVersion },
          apiRow2.id
        );
        await handleSlackSlashCommand({
          command: "/opm",
          text: `link ${user2ApiToken}`,
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

      expect(res.response_type).toBe("ephemeral");
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

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("Dedicated Key Card");

      const card = await db.card.findFirst({
        where: { projectId, title: "Dedicated Key Card" },
      });
      expect(card).not.toBeNull();
      expect(card?.title).toBe("Dedicated Key Card");
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
      try {
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

        const cardTitle = `Card for Owner B ${Date.now()}`;
        // Owner B creates card with projectKey
        const res = await handleSlackSlashCommand({
          command: "/opm",
          text: `create ${projectKey} ${cardTitle}`,
          user_id: "U_OWNER_B",
        });

        expect(res.response_type).toBe("ephemeral");
        expect(res.text).toContain("Project B Same Key");

        const card = await db.card.findFirst({
          where: { projectId: projectB.id, title: cardTitle },
        });
        expect(card?.projectId).toBe(projectB.id);
        expect(card?.projectId).not.toBe(projectId);
      } finally {
        await cleanupTestUser(ownerB.user.id);
      }
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

    it("prevents looking up a card in another user's project where caller has no membership", async () => {
      const otherUser = await createTestUser(`slack-other-${Date.now()}`);
      const otherProject = await createTestProject(otherUser.user.id, "Secret Project");
      const otherCol = await db.column.create({
        data: {
          projectId: otherProject.id,
          name: "Backlog",
          group: "BACKLOG",
          order: 1,
        },
      });
      await db.card.create({
        data: {
          projectId: otherProject.id,
          columnId: otherCol.id,
          title: "Confidential Strategy",
          number: 1,
          order: 1000,
        },
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${otherProject.key}-1`,
        user_id: "U_TEST_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("was not found or you do not have permission to view it");

      await cleanupTestUser(otherUser.user.id);
    });

    it("rejects invalid or overflow identifiers in /opm get without throwing", async () => {
      const resOverflow = await handleSlackSlashCommand({
        command: "/opm",
        text: "get ENG-99999999999999999999",
        user_id: "U_TEST_USER",
      });
      expect(resOverflow.response_type).toBe("ephemeral");
      expect(resOverflow.text).toContain("Invalid card identifier format");

      const resBad1 = await handleSlackSlashCommand({
        command: "/opm",
        text: "get ENG-2abc",
        user_id: "U_TEST_USER",
      });
      expect(resBad1.response_type).toBe("ephemeral");
      expect(resBad1.text).toContain("Invalid card identifier format");

      const resBad2 = await handleSlackSlashCommand({
        command: "/opm",
        text: "get ENG-2-9",
        user_id: "U_TEST_USER",
      });
      expect(resBad2.response_type).toBe("ephemeral");
      expect(resBad2.text).toContain("Invalid card identifier format");
    });

    it("does not return archived cards in /opm get", async () => {
      const col = await db.column.findFirst({ where: { projectId } });
      const card = await db.card.create({
        data: {
          projectId,
          columnId: col!.id,
          title: "Archived Card",
          number: 77,
          order: 1000,
          isArchived: true,
        },
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-${card.number}`,
        user_id: "U_TEST_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      expect(res.text).toContain("was not found or you do not have permission to view it");
    });

    it("allows project ADMINs to create cards via /opm create and /opm new", async () => {
      const adminRes = await createTestUser(`slack-admin-${Date.now()}`);
      await db.projectMember.create({
        data: {
          projectId,
          userId: adminRes.user.id,
          role: "ADMIN",
        },
      });
      await linkSlackUser("U_ADMIN", adminRes.user.id);

      const resCreate = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Admin Created Card`,
        user_id: "U_ADMIN",
      });
      expect(resCreate.response_type).toBe("ephemeral");
      expect(resCreate.text).toContain("Admin Created Card");

      const resNew = await handleSlackSlashCommand({
        command: "/opm",
        text: "new Admin New Card",
        user_id: "U_ADMIN",
      });
      expect(resNew.response_type).toBe("ephemeral");
      expect(resNew.text).toContain("Admin New Card");

      await cleanupTestUser(adminRes.user.id);
    });

    it("includes project name in /opm get unfurl response", async () => {
      const col = await db.column.findFirst({ where: { projectId } });
      await db.card.create({
        data: {
          projectId,
          columnId: col!.id,
          title: "Unfurl Target Card",
          number: 55,
          order: 1000,
        },
      });

      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `get ${projectKey}-55`,
        user_id: "U_TEST_USER",
      });

      expect(res.response_type).toBe("ephemeral");
      const blockText = (res.blocks?.[0] as any)?.text?.text;
      expect(blockText).toContain("Slack App Test Project");
    });

    it("decodes Slack entities when storing card title", async () => {
      const res = await handleSlackSlashCommand({
        command: "/opm",
        text: `create ${projectKey} Fix A &amp; B &lt;feature&gt; <https://example.com|docs>`,
        user_id: "U_TEST_USER",
      });
      expect(res.response_type).toBe("ephemeral");

      const card = await db.card.findFirst({
        where: { projectId, title: "Fix A & B <feature> docs" },
      });
      expect(card).not.toBeNull();
      expect(card?.title).toBe("Fix A & B <feature> docs");
    });

    it("invalidates linked user when the underlying API token is deleted", async () => {
      const userRes = await createTestUser(`api-token-revoked-${Date.now()}`);
      try {
        const apiRow = await db.apiToken.create({
          data: {
            userId: userRes.user.id,
            name: "Revocable Token",
          },
        });
        const apiTok = await signApiToken(
          { userId: userRes.user.id, email: userRes.user.email, name: userRes.user.name, tokenVersion: userRes.user.tokenVersion },
          apiRow.id
        );

        await handleSlackSlashCommand({
          command: "/opm",
          text: `link ${apiTok}`,
          user_id: "U_REVOCABLE_USER",
        });

        const who1 = await handleSlackSlashCommand({
          command: "/opm",
          text: "whoami",
          user_id: "U_REVOCABLE_USER",
        });
        expect(who1.text).toContain(userRes.user.email);

        // Delete ApiToken row (simulating revokeApiToken)
        await db.apiToken.delete({ where: { id: apiRow.id } });

        const who2 = await handleSlackSlashCommand({
          command: "/opm",
          text: "whoami",
          user_id: "U_REVOCABLE_USER",
        });
        expect(who2.text).toContain("Your Slack account is not linked");
      } finally {
        await cleanupTestUser(userRes.user.id);
      }
    });

    it("disambiguates identical keys across owners using owner/KEY syntax", async () => {
      const owner2Res = await createTestUser(`owner2-${Date.now()}`);
      try {
        const project2 = await db.project.create({
          data: {
            userId: owner2Res.user.id,
            name: "Owner 2 Project",
            key: projectKey,
            color: "#10b981",
          },
        });
        await db.column.create({
          data: {
            projectId: project2.id,
            name: "Backlog",
            group: "BACKLOG",
            order: 1,
          },
        });
        await db.projectMember.create({
          data: {
            projectId: project2.id,
            userId,
            role: "MEMBER",
          },
        });

        // Create card in owner2's project via owner/KEY syntax
        const resCreate = await handleSlackSlashCommand({
          command: "/opm",
          text: `create ${owner2Res.user.email}/${projectKey} Card in Owner2 Project`,
          user_id: "U_TEST_USER",
        });
        expect(resCreate.response_type).toBe("ephemeral");
        expect(resCreate.text).toContain("Created card");

        const cardIn2 = await db.card.findFirst({
          where: { projectId: project2.id, title: "Card in Owner2 Project" },
        });
        expect(cardIn2).not.toBeNull();
        expect(cardIn2?.title).toBe("Card in Owner2 Project");

        // Get card using owner/KEY-number syntax
        const resGet = await handleSlackSlashCommand({
          command: "/opm",
          text: `get ${owner2Res.user.email}/${projectKey}-${cardIn2!.number}`,
          user_id: "U_TEST_USER",
        });
        expect(resGet.response_type).toBe("ephemeral");
        expect(resGet.text).toContain("Card in Owner2 Project");
      } finally {
        await cleanupTestUser(owner2Res.user.id);
      }
    });

    it("rejects empty owner in /KEY and rejects ambiguous owner prefixes like a/KEY", async () => {
      const alice = await createTestUser(`alice-slack-${Date.now()}`);
      const alan = await createTestUser(`alan-slack-${Date.now()}`);
      try {
        const prefix = `AMBIG${Date.now().toString().slice(-4)}`;
        const pAlice = await db.project.create({
          data: { userId: alice.user.id, name: "Alice Project", key: prefix, color: "#6366f1" },
        });
        const pAlan = await db.project.create({
          data: { userId: alan.user.id, name: "Alan Project", key: prefix, color: "#ec4899" },
        });

        const colAlice = await db.column.create({
          data: { projectId: pAlice.id, name: "Backlog", group: "BACKLOG", order: 1 },
        });
        const colAlan = await db.column.create({
          data: { projectId: pAlan.id, name: "Backlog", group: "BACKLOG", order: 1 },
        });

        await db.projectMember.createMany({
          data: [
            { projectId: pAlice.id, userId, role: "MEMBER" },
            { projectId: pAlan.id, userId, role: "MEMBER" },
          ],
        });

        await db.card.create({
          data: { projectId: pAlice.id, columnId: colAlice.id, title: "Alice Card", number: 1, order: 1000 },
        });
        await db.card.create({
          data: { projectId: pAlan.id, columnId: colAlan.id, title: "Alan Card", number: 1, order: 1000 },
        });

        // Empty owner prefix `/KEY` must fail validation rather than falling through
        const emptyOwnerCreate = await handleSlackSlashCommand({
          command: "/opm",
          text: `create /${prefix} Bad Card`,
          user_id: "U_TEST_USER",
        });
        expect(emptyOwnerCreate.response_type).toBe("ephemeral");
        expect(emptyOwnerCreate.text).toContain("Invalid target format");

        const emptyOwnerGet = await handleSlackSlashCommand({
          command: "/opm",
          text: `get /${prefix}-1`,
          user_id: "U_TEST_USER",
        });
        expect(emptyOwnerGet.response_type).toBe("ephemeral");
        expect(emptyOwnerGet.text).toContain("Invalid target format");

        // Shared prefix matching both test users (both emails contain/start with `al` if we use exact email prefix: wait — test user helper prefixes emails; use exact common prefix)
        const commonPrefix = alice.user.email.slice(0, 2); // fails if alan starts with "al" and alice starts with "al" -> both start with "al"!
        const ambigCreate = await handleSlackSlashCommand({
          command: "/opm",
          text: `create ${commonPrefix}/${prefix} Ambiguous Card`,
          user_id: "U_TEST_USER",
        });
        expect(ambigCreate.response_type).toBe("ephemeral");
        expect(ambigCreate.text).toContain("Multiple projects");

        const ambigGet = await handleSlackSlashCommand({
          command: "/opm",
          text: `get ${commonPrefix}/${prefix}-1`,
          user_id: "U_TEST_USER",
        });
        expect(ambigGet.response_type).toBe("ephemeral");
        expect(ambigGet.text).toContain("Multiple projects");

        // Exact local-part match succeeds unambiguously
        const aliceLocalPart = alice.user.email.split("@")[0];
        const exactCreate = await handleSlackSlashCommand({
          command: "/opm",
          text: `create ${aliceLocalPart}/${prefix} Alice Unambiguous Card`,
          user_id: "U_TEST_USER",
        });
        expect(exactCreate.text).toContain("Created card");

        const aliceCard = await db.card.findFirst({
          where: { projectId: pAlice.id, title: "Alice Unambiguous Card" },
        });
        expect(aliceCard).not.toBeNull();
        expect(aliceCard?.title).toBe("Alice Unambiguous Card");
      } finally {
        await cleanupTestUser(alice.user.id);
        await cleanupTestUser(alan.user.id);
      }
    });

    it("allows viewing cards in INTERNAL visibility projects", async () => {
      const internalOwner = await createTestUser(`internal-owner-${Date.now()}`);
      try {
        const internalProject = await db.project.create({
          data: {
            userId: internalOwner.user.id,
            name: "Internal Company Project",
            key: "INTRN",
            color: "#6366f1",
            visibility: "INTERNAL",
          },
        });
        const col = await db.column.create({
          data: {
            projectId: internalProject.id,
            name: "Backlog",
            group: "BACKLOG",
            order: 1,
          },
        });
        const card = await db.card.create({
          data: {
            projectId: internalProject.id,
            columnId: col.id,
            title: "Internal Visible Card",
            number: 1,
            order: 1000,
          },
        });

        const resGet = await handleSlackSlashCommand({
          command: "/opm",
          text: `get INTRN-1`,
          user_id: "U_TEST_USER",
        });
        expect(resGet.response_type).toBe("ephemeral");
        expect(resGet.text).toContain("Internal Visible Card");
      } finally {
        await cleanupTestUser(internalOwner.user.id);
      }
    });
  });
});
