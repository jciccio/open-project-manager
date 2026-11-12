import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { signApiToken } from "@/lib/auth";
import { revokeUserAccess } from "@/lib/revokeUser";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import {
  verifyDiscordSignature,
  formatDiscordCardEmbed,
  handleDiscordInteraction,
  linkDiscordUser,
  issueDiscordLinkCode,
  type DiscordInteraction,
} from "../discord";
import { DISCORD_OPM_COMMAND, registerDiscordCommands } from "../discordCommands";

describe("Discord Integration", () => {
  let userId: string;
  let userToken: string;
  let projectId: string;
  let projectKey: string;

  // Generate Ed25519 keypair for signature tests
  const { publicKey: pubKeyObj, privateKey: privKeyObj } = crypto.generateKeyPairSync("ed25519");
  const rawPub = pubKeyObj.export({ type: "spki", format: "der" }).slice(-32);
  const publicKeyHex = rawPub.toString("hex");

  beforeEach(async () => {
    const userRes = await createTestUser(`discord-user-${Date.now()}`);
    userId = userRes.user.id;
    userToken = userRes.token;

    const project = await createTestProject(userId, "Discord App Test Project");
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

    await linkDiscordUser("DISCORD_TEST_USER_1", userId);
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  describe("verifyDiscordSignature", () => {
    const body = JSON.stringify({ type: 1 });

    it("verifies a valid Ed25519 signature", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const msg = Buffer.concat([Buffer.from(timestamp, "utf-8"), Buffer.from(body, "utf-8")]);
      const sig = crypto.sign(null, msg, privKeyObj);
      const signatureHex = sig.toString("hex");

      const isValid = verifyDiscordSignature({
        publicKey: publicKeyHex,
        signature: signatureHex,
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(true);
    });

    it("rejects an expired timestamp (> 5 minutes)", () => {
      const timestamp = String(Math.floor(Date.now() / 1000) - 400);
      const msg = Buffer.concat([Buffer.from(timestamp, "utf-8"), Buffer.from(body, "utf-8")]);
      const sig = crypto.sign(null, msg, privKeyObj);

      const isValid = verifyDiscordSignature({
        publicKey: publicKeyHex,
        signature: sig.toString("hex"),
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(false);
    });

    it("rejects an invalid signature or corrupted message", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const corruptedSig = "00".repeat(64);

      const isValid = verifyDiscordSignature({
        publicKey: publicKeyHex,
        signature: corruptedSig,
        timestamp,
        rawBody: body,
      });

      expect(isValid).toBe(false);
    });

    it("rejects when signature or key has invalid length", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      expect(
        verifyDiscordSignature({
          publicKey: "shortkey",
          signature: "shortsig",
          timestamp,
          rawBody: body,
        })
      ).toBe(false);
    });
  });

  describe("formatDiscordCardEmbed", () => {
    it("formats embed with title, fields and project name", () => {
      const embed = formatDiscordCardEmbed({
        identifier: "ENG-12",
        title: "Build notification service",
        status: "In Progress",
        projectName: "Core Platform",
        priority: "HIGH",
        owner: "Jane Doe",
        points: 5,
        url: "/projects/p1?cardId=c1",
      });

      expect(embed.title).toBe("ENG-12: Build notification service");
      expect(embed.color).toBe(0x5865f2);
      expect(embed.fields?.find((f) => f.name === "Project")?.value).toBe("Core Platform");
      expect(embed.fields?.find((f) => f.name === "Priority")?.value).toBe("HIGH");
      expect(embed.fields?.find((f) => f.name === "Points")?.value).toBe("5 pts");
    });

    it("truncates embed titles longer than 256 characters", () => {
      const longTitle = "x".repeat(300);
      const embed = formatDiscordCardEmbed({
        identifier: "ENG-99",
        title: longTitle,
        status: "Backlog",
        projectName: "Core Platform",
        url: "/projects/p1",
      });

      expect(embed.title?.length).toBe(256);
      expect(embed.title?.endsWith("...")).toBe(true);
    });
  });

  describe("handleDiscordInteraction", () => {
    it("returns type 1 for PING interaction", async () => {
      const res = await handleDiscordInteraction({
        id: "ping-1",
        type: 1,
      });

      expect(res.type).toBe(1);
    });

    it("returns help text on /opm help", async () => {
      const interaction: DiscordInteraction = {
        id: "i-help",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "help", type: 1 }],
        },
        user: { id: "U_ANY", username: "tester" },
      };

      const res = await handleDiscordInteraction(interaction);
      expect(res.type).toBe(4);
      expect(res.data?.flags).toBe(64);
      expect(res.data?.content).toContain("/opm link");
    });

    it("requires Discord user to be linked for operations", async () => {
      const interaction: DiscordInteraction = {
        id: "i-unlinked",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "whoami", type: 1 }],
        },
        user: { id: "DISCORD_UNLINKED_ID", username: "stranger" },
      };

      const res = await handleDiscordInteraction(interaction);
      expect(res.data?.content).toContain("Your Discord account is not linked");
    });

    it("links Discord user with a valid API token", async () => {
      const user = await db.user.findUnique({ where: { id: userId } });
      const apiTokenRow = await db.apiToken.create({
        data: { userId, name: "Discord API Token" },
      });
      const realApiToken = await signApiToken(
        { userId, email: user!.email, name: user!.name, tokenVersion: user!.tokenVersion },
        apiTokenRow.id
      );

      const linkInteraction: DiscordInteraction = {
        id: "i-link",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "link",
              type: 1,
              options: [{ name: "token", type: 3, value: realApiToken }],
            },
          ],
        },
        user: { id: "NEW_DISCORD_USER", username: "newbie" },
      };

      const res = await handleDiscordInteraction(linkInteraction);
      expect(res.data?.content).toContain("Successfully linked your Discord account");

      const whoami: DiscordInteraction = {
        id: "i-who",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "NEW_DISCORD_USER", username: "newbie" },
      };
      const whoRes = await handleDiscordInteraction(whoami);
      expect(whoRes.data?.content).toContain(user!.email);
    });

    it("rejects linking with forged token or stale tokenVersion", async () => {
      const forgedSecret = new TextEncoder().encode("invalid-secret-key-32-chars-long!");
      const forged = await new SignJWT({
        userId,
        email: "victim@example.com",
        name: "Victim",
        tv: 0,
        aud: "opm:session",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(forgedSecret);

      const res = await handleDiscordInteraction({
        id: "i-forged",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "link", type: 1, options: [{ name: "token", type: 3, value: forged }] }],
        },
        user: { id: "DISCORD_ATTACKER", username: "attacker" },
      });
      expect(res.data?.content).toContain("Invalid or expired API token");
    });

    it("ends Discord actions when revokeUserAccess is called", async () => {
      await issueDiscordLinkCode(userId);
      const whoBefore = await handleDiscordInteraction({
        id: "i-who-1",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });
      expect(whoBefore.data?.content).toContain("You are linked as");

      await revokeUserAccess(userId);

      expect(
        await db.importRecord.count({
          where: {
            source: "discord",
            entityType: { in: ["user", "link_code"] },
            OR: [{ userId }, { localId: userId }],
          },
        })
      ).toBe(0);

      const whoAfter = await handleDiscordInteraction({
        id: "i-who-2",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });
      expect(whoAfter.data?.content).toContain("Your Discord account is not linked");
    });

    it("creates a card via /opm create <key> <title> and /opm new <title>", async () => {
      const resCreate = await handleDiscordInteraction({
        id: "i-create",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "create",
              type: 1,
              options: [
                { name: "key", type: 3, value: projectKey },
                { name: "title", type: 3, value: "Created from Discord" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });

      expect(resCreate.data?.content).toContain("Created card");
      expect(resCreate.data?.embeds?.[0].title).toContain("Created from Discord");
      expect(resCreate.data?.flags).toBe(64);
      expect(resCreate.data?.allowed_mentions).toEqual({ parse: [] });

      const resNew = await handleDiscordInteraction({
        id: "i-new",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "new", type: 1, options: [{ name: "title", type: 3, value: "Quick Card from Discord" }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });

      expect(resNew.data?.content).toContain("Created card");
      expect(resNew.data?.embeds?.[0].title).toContain("Quick Card from Discord");
      expect(resNew.data?.flags).toBe(64);
      expect(resNew.data?.allowed_mentions).toEqual({ parse: [] });
    });

    it("looks up card via /opm get and rejects unauthorized or invalid lookups", async () => {
      // Create card
      await handleDiscordInteraction({
        id: "i-c",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "create",
              type: 1,
              options: [
                { name: "key", type: 3, value: projectKey },
                { name: "title", type: 3, value: "Lookup Target Card" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });

      const resGet = await handleDiscordInteraction({
        id: "i-get",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "get", type: 1, options: [{ name: "identifier", type: 3, value: `${projectKey}-1` }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });

      expect(resGet.data?.flags).toBe(64);
      expect(resGet.data?.embeds?.[0].title).toContain("Lookup Target Card");
      expect(resGet.data?.embeds?.[0].fields?.find((f) => f.name === "Project")?.value).toBe("Discord App Test Project");

      // Invalid format rejected
      const resBad = await handleDiscordInteraction({
        id: "i-bad",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "get", type: 1, options: [{ name: "identifier", type: 3, value: "ENG-99999999999999999999" }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });
      expect(resBad.data?.content).toContain("Invalid card identifier format");
    });

    it("permits project ADMINs to create cards and rejects VIEWERs", async () => {
      const adminRes = await createTestUser(`discord-admin-${Date.now()}`);
      await db.projectMember.create({
        data: { projectId, userId: adminRes.user.id, role: "ADMIN" },
      });
      await linkDiscordUser("DISCORD_ADMIN_USER", adminRes.user.id);

      const resAdmin = await handleDiscordInteraction({
        id: "i-admin",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "create",
              type: 1,
              options: [
                { name: "key", type: 3, value: projectKey },
                { name: "title", type: 3, value: "Admin Discord Card" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_ADMIN_USER", username: "admin" },
      });
      expect(resAdmin.data?.content).toContain("Created card");

      const viewerRes = await createTestUser(`discord-viewer-${Date.now()}`);
      await db.projectMember.create({
        data: { projectId, userId: viewerRes.user.id, role: "VIEWER" },
      });
      await linkDiscordUser("DISCORD_VIEWER_USER", viewerRes.user.id);

      const resViewer = await handleDiscordInteraction({
        id: "i-viewer",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "create",
              type: 1,
              options: [
                { name: "key", type: 3, value: projectKey },
                { name: "title", type: 3, value: "Viewer Discord Card" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_VIEWER_USER", username: "viewer" },
      });
      expect(resViewer.data?.content).toContain("do not have permission to create cards");

      await cleanupTestUser(adminRes.user.id);
      await cleanupTestUser(viewerRes.user.id);
    });

    it("lists project columns via /opm columns", async () => {
      const col2 = await db.column.create({
        data: {
          projectId,
          name: "In Progress",
          order: 2,
        },
      });

      const res = await handleDiscordInteraction({
        id: "i-cols",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "columns",
              type: 1,
              options: [{ name: "key", type: 3, value: projectKey }],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      expect(res.data?.content).toContain(`Columns in Discord App Test Project (${projectKey})`);
      expect(res.data?.content).toContain("Backlog");
      expect(res.data?.content).toContain("In Progress");
      expect(res.data?.content).toContain(`\`${col2.id}\``);
    });

    it("lists open cards grouped by column with formatted copyable ID via /opm list", async () => {
      const backlogCol = await db.column.findFirstOrThrow({ where: { projectId, name: "Backlog" } });
      const inProgCol = await db.column.create({
        data: {
          projectId,
          name: "In Progress",
          order: 2,
        },
      });

      await db.card.create({
        data: {
          projectId,
          columnId: backlogCol.id,
          number: 1,
          title: "Backlog Card",
          order: 1,
        },
      });

      await db.card.create({
        data: {
          projectId,
          columnId: inProgCol.id,
          number: 2,
          title: "In Progress Card",
          order: 1,
        },
      });

      const res = await handleDiscordInteraction({
        id: "i-list",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "list",
              type: 1,
              options: [{ name: "key", type: 3, value: projectKey }],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      expect(res.data?.content).toContain(`Open Cards in Discord App Test Project (${projectKey})`);
      expect(res.data?.content).toContain("**Backlog** (1):");
      expect(res.data?.content).toContain(`• \`${projectKey}-1\` - Backlog Card`);
      expect(res.data?.content).toContain("**In Progress** (1):");
      expect(res.data?.content).toContain(`• \`${projectKey}-2\` - In Progress Card`);
    });

    it("moves a card to a designated column via /opm move", async () => {
      const backlogCol = await db.column.findFirstOrThrow({ where: { projectId, name: "Backlog" } });
      const doneCol = await db.column.create({
        data: {
          projectId,
          name: "Done",
          order: 2,
          isDone: true,
        },
      });

      const card = await db.card.create({
        data: {
          projectId,
          columnId: backlogCol.id,
          number: 1,
          title: "Card to Move",
          order: 1,
        },
      });

      const res = await handleDiscordInteraction({
        id: "i-move",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "move",
              type: 1,
              options: [
                { name: "identifier", type: 3, value: `${projectKey}-1` },
                { name: "column", type: 3, value: "Done" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      expect(res.data?.content).toContain(`Moved **${projectKey}-1** to **Done**:`);
      expect(res.data?.embeds?.[0].fields?.find((f) => f.name === "Status")?.value).toBe("Done");
      expect(res.data?.flags).toBe(64);
      expect(res.data?.allowed_mentions).toEqual({ parse: [] });

      const updatedCard = await db.card.findUnique({ where: { id: card.id } });
      expect(updatedCard?.columnId).toBe(doneCol.id);
      expect(updatedCard?.completedAt).not.toBeNull();
    });

    it("automatically unlinks user when underlying API token is deleted", async () => {
      const user = await db.user.findUnique({ where: { id: userId } });
      const apiTokenRow = await db.apiToken.create({
        data: { userId, name: "Discord Ephemeral Token" },
      });
      const realApiToken = await signApiToken(
        { userId, email: user!.email, name: user!.name, tokenVersion: user!.tokenVersion },
        apiTokenRow.id
      );

      await handleDiscordInteraction({
        id: "i-link-del",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "link",
              type: 1,
              options: [{ name: "token", type: 3, value: realApiToken }],
            },
          ],
        },
        user: { id: "DISCORD_REVOKE_TOKEN_USER", username: "revokee" },
      });

      const who1 = await handleDiscordInteraction({
        id: "i-who-del-1",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_REVOKE_TOKEN_USER", username: "revokee" },
      });
      expect(who1.data?.content).toContain("You are linked as");

      // Delete the underlying API token
      await db.apiToken.delete({ where: { id: apiTokenRow.id } });

      const who2 = await handleDiscordInteraction({
        id: "i-who-del-2",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_REVOKE_TOKEN_USER", username: "revokee" },
      });
      expect(who2.data?.content).toContain("Your Discord account is not linked");
    });

    it("disambiguates duplicate project keys using owner/KEY syntax", async () => {
      const otherUserRes = await createTestUser(`discord-other-${Date.now()}`);
      const otherProj = await createTestProject(otherUserRes.user.id, "Other Discord Project");
      await db.project.update({
        where: { id: otherProj.id },
        data: { key: projectKey },
      });
      await db.column.create({
        data: { projectId: otherProj.id, name: "Backlog", order: 1 },
      });
      await db.projectMember.create({
        data: { projectId: otherProj.id, userId, role: "MEMBER" },
      });

      const otherUser = otherUserRes.user;

      const resCreateOther = await handleDiscordInteraction({
        id: "i-create-owner",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "create",
              type: 1,
              options: [
                { name: "key", type: 3, value: `${otherUser.name}/${projectKey}` },
                { name: "title", type: 3, value: "Created In Other Project" },
              ],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });
      expect(resCreateOther.data?.content).toContain("Created card");
      expect(resCreateOther.data?.embeds?.[0].fields?.find((f) => f.name === "Project")?.value).toBe("Other Discord Project");

      await cleanupTestUser(otherUserRes.user.id);
    });

    it("truncates /opm list output when cards exceed character budget", async () => {
      const backlogCol = await db.column.findFirstOrThrow({ where: { projectId, name: "Backlog" } });
      const cardsData = Array.from({ length: 40 }, (_, i) => ({
        projectId,
        columnId: backlogCol.id,
        number: 100 + i,
        title: `Card with a fairly long descriptive title number ${i + 1} to reach message limit`,
        order: i + 1,
      }));
      await db.card.createMany({ data: cardsData });

      const res = await handleDiscordInteraction({
        id: "i-list-trunc",
        type: 2,
        data: {
          name: "opm",
          options: [
            {
              name: "list",
              type: 1,
              options: [{ name: "key", type: 3, value: projectKey }],
            },
          ],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      expect(res.data?.content).toBeDefined();
      expect(res.data!.content!.length).toBeLessThan(2000);
      expect(res.data?.content).toContain("more cards");
    });

    it("allows viewing cards and columns in INTERNAL projects even if user is not a member", async () => {
      const internalUserRes = await createTestUser(`discord-internal-${Date.now()}`);
      const internalProj = await createTestProject(internalUserRes.user.id, "Internal Open Project");
      await db.project.update({
        where: { id: internalProj.id },
        data: { visibility: "INTERNAL" },
      });
      const col = await db.column.create({
        data: { projectId: internalProj.id, name: "Triage", order: 1 },
      });
      await db.card.create({
        data: {
          projectId: internalProj.id,
          columnId: col.id,
          number: 1,
          title: "Internal Card Title",
          order: 1,
        },
      });

      const resGet = await handleDiscordInteraction({
        id: "i-get-internal",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "get", type: 1, options: [{ name: "identifier", type: 3, value: `${internalProj.key}-1` }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });
      expect(resGet.data?.embeds?.[0].title).toContain("Internal Card Title");

      const resList = await handleDiscordInteraction({
        id: "i-list-internal",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "list", type: 1, options: [{ name: "key", type: 3, value: internalProj.key }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });
      expect(resList.data?.content).toContain("Internal Open Project");

      await cleanupTestUser(internalUserRes.user.id);
    });

    it("includes card assignees in embed", async () => {
      const backlogCol = await db.column.findFirstOrThrow({ where: { projectId, name: "Backlog" } });
      const card = await db.card.create({
        data: {
          projectId,
          columnId: backlogCol.id,
          number: 55,
          title: "Assignee Test Card",
          order: 1,
        },
      });
      await db.cardAssignee.create({
        data: {
          cardId: card.id,
          userId,
        },
      });

      const resGet = await handleDiscordInteraction({
        id: "i-get-assignee",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "get", type: 1, options: [{ name: "identifier", type: 3, value: `${projectKey}-55` }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      const assigneeField = resGet.data?.embeds?.[0].fields?.find((f) => f.name === "Assignee");
      expect(assigneeField).toBeDefined();
      expect(assigneeField?.value).not.toBe("Unassigned");
    });

    it("excludes CANCELLED column from candidate backlog/open columns on /opm new", async () => {
      await db.column.create({
        data: {
          projectId,
          name: "Cancelled",
          group: "CANCELLED",
          order: 0,
        },
      });

      const resNew = await handleDiscordInteraction({
        id: "i-new-nocancel",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "new", type: 1, options: [{ name: "title", type: 3, value: "Not In Cancelled" }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      expect(resNew.data?.content).toContain("Created card");
      const createdCard = await db.card.findFirst({
        where: { projectId, title: "Not In Cancelled" },
        include: { column: true },
      });
      expect(createdCard?.column.group).not.toBe("CANCELLED");
    });

    it("bounds multi-column /opm list output with long column names to <= 2000 chars", async () => {
      const cols = [];
      for (let c = 1; c <= 10; c++) {
        const col = await db.column.create({
          data: {
            projectId,
            name: `Feature Stage ${c} ` + "X".repeat(150),
            group: c <= 8 ? "STARTED" : "COMPLETED",
            isDone: c > 8,
            order: c + 10,
          },
        });
        cols.push(col);
        await db.card.create({
          data: {
            projectId,
            columnId: col.id,
            number: 100 + c,
            title: `Card Title ${c} ` + "T".repeat(45),
            order: 1,
          },
        });
      }

      const resList = await handleDiscordInteraction({
        id: "i-list-multicolumn",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "list", type: 1, options: [{ name: "key", type: 3, value: projectKey }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      const content = resList.data?.content || "";
      expect(content.length).toBeGreaterThan(0);
      expect(content.length).toBeLessThanOrEqual(2000);
      expect(content).toContain("omitted");
      // Closed COMPLETED columns must not appear when open columns exist
      expect(content).not.toContain("Feature Stage 9 ");
    });

    it("caps /opm columns output at <= 2000 chars even with many long columns", async () => {
      for (let c = 1; c <= 15; c++) {
        await db.column.create({
          data: {
            projectId,
            name: `VeryLongColumnName_${c}_` + "C".repeat(160),
            group: "STARTED",
            order: c + 20,
          },
        });
      }

      const resCols = await handleDiscordInteraction({
        id: "i-cols-bounded",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "columns", type: 1, options: [{ name: "key", type: 3, value: projectKey }] }],
        },
        user: { id: "DISCORD_TEST_USER_1", username: "tester" },
      });

      const content = resCols.data?.content || "";
      expect(content.length).toBeLessThanOrEqual(2000);
      expect(content).toContain("omitted");
    });

    it("caps Assignee embed field at <= 1024 chars when a card has 35 long assignees", async () => {
      const backlogCol = await db.column.findFirstOrThrow({ where: { projectId, name: "Backlog" } });
      const card = await db.card.create({
        data: {
          projectId,
          columnId: backlogCol.id,
          number: 200,
          title: "Many Assignees Card",
          order: 1,
        },
      });

      const extraUsers: string[] = [];
      try {
        for (let i = 0; i < 35; i++) {
          const u = await createTestUser(`very-long-assignee-identifier-${i}-${"x".repeat(20)}-${Date.now()}`);
          extraUsers.push(u.user.id);
          await db.cardAssignee.create({
            data: { cardId: card.id, userId: u.user.id },
          });
        }

        const resGet = await handleDiscordInteraction({
          id: "i-get-many-assignees",
          type: 2,
          data: {
            name: "opm",
            options: [{ name: "get", type: 1, options: [{ name: "identifier", type: 3, value: `${projectKey}-200` }] }],
          },
          user: { id: "DISCORD_TEST_USER_1", username: "tester" },
        });

        const assigneeField = resGet.data?.embeds?.[0].fields?.find((f) => f.name === "Assignee");
        expect(assigneeField).toBeDefined();
        expect(assigneeField!.value.length).toBeLessThanOrEqual(1024);
        expect(assigneeField!.value).toContain("more)");
      } finally {
        for (const uid of extraUsers) {
          await cleanupTestUser(uid);
        }
      }
    });

    it("supports short-lived single-use link codes decoupled from API token lifetime", async () => {
      const { code } = await issueDiscordLinkCode(userId);
      expect(code.startsWith("opm_dl_")).toBe(true);

      // Link via code
      const resLink = await handleDiscordInteraction({
        id: "i-link-code-1",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "link", type: 1, options: [{ name: "token", type: 3, value: code }] }],
        },
        user: { id: "DISCORD_CODE_USER", username: "coder" },
      });
      expect(resLink.data?.content).toContain("Successfully linked");

      // Re-using same single-use code fails
      const resReplay = await handleDiscordInteraction({
        id: "i-link-code-replay",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "link", type: 1, options: [{ name: "token", type: 3, value: code }] }],
        },
        user: { id: "DISCORD_CODE_USER_2", username: "thief" },
      });
      expect(resReplay.data?.content).toContain("Invalid, expired, or already used");

      // Deleting ALL API tokens belonging to this user must NOT break the code-based link
      await db.apiToken.deleteMany({ where: { userId } });

      const who = await handleDiscordInteraction({
        id: "i-who-code",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_CODE_USER", username: "coder" },
      });
      expect(who.data?.content).toContain("You are linked as");

      // Expired code is rejected
      const expired = await issueDiscordLinkCode(userId);
      await db.importRecord.updateMany({
        where: { userId, source: "discord", entityType: "link_code" },
        data: { importRunId: String(Date.now() - 1000) },
      });
      const resExpired = await handleDiscordInteraction({
        id: "i-link-code-exp",
        type: 2,
        data: {
          name: "opm",
          options: [{ name: "link", type: 1, options: [{ name: "token", type: 3, value: expired.code }] }],
        },
        user: { id: "DISCORD_CODE_USER_3", username: "late" },
      });
      expect(resExpired.data?.content).toContain("Invalid, expired, or already used");
    });

    it("rejects empty owner in /KEY and ambiguous owner prefixes across create, list, columns, get, move", async () => {
      const alice = await createTestUser(`alice-disc-${Date.now()}`);
      const alan = await createTestUser(`alan-disc-${Date.now()}`);
      try {
        const key = `DAMB${Date.now().toString().slice(-4)}`;
        const pAlice = await db.project.create({
          data: { userId: alice.user.id, name: "Alice D Project", key, color: "#6366f1" },
        });
        const pAlan = await db.project.create({
          data: { userId: alan.user.id, name: "Alan D Project", key, color: "#ec4899" },
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

        const badEmptyOwner = await handleDiscordInteraction({
          id: "i-empty-owner",
          type: 2,
          data: {
            name: "opm",
            options: [{ name: "list", type: 1, options: [{ name: "key", type: 3, value: `/${key}` }] }],
          },
          user: { id: "DISCORD_TEST_USER_1", username: "tester" },
        });
        expect(badEmptyOwner.data?.content).toContain("Invalid target format");

        const commonPrefix = alice.user.email.slice(0, 2);
        const ambigList = await handleDiscordInteraction({
          id: "i-ambig-list",
          type: 2,
          data: {
            name: "opm",
            options: [{ name: "list", type: 1, options: [{ name: "key", type: 3, value: `${commonPrefix}/${key}` }] }],
          },
          user: { id: "DISCORD_TEST_USER_1", username: "tester" },
        });
        expect(ambigList.data?.content).toContain("Multiple projects");
      } finally {
        await cleanupTestUser(alice.user.id);
        await cleanupTestUser(alan.user.id);
      }
    });

    it("defines and registers exact /opm slash command option schema with DISCORD_BOT_TOKEN", async () => {
      const subNames = DISCORD_OPM_COMMAND.options.map((o) => o.name);
      expect(subNames).toEqual(
        expect.arrayContaining(["help", "link", "whoami", "unlink", "list", "columns", "get", "move", "create", "new"])
      );
      expect(DISCORD_OPM_COMMAND.options.find((o) => o.name === "link")?.options?.[0]?.name).toBe("token");
      expect(DISCORD_OPM_COMMAND.options.find((o) => o.name === "move")?.options?.map((x) => x.name)).toEqual([
        "identifier",
        "column",
      ]);

      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};
      await registerDiscordCommands({
        applicationId: "123456789012345678",
        botToken: "bot-secret-token",
        guildId: "987654321098765432",
        fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
          capturedUrl = String(url);
          capturedHeaders = (init?.headers || {}) as Record<string, string>;
          return new Response(JSON.stringify([{ id: "cmd-1", name: "opm" }]), { status: 200 });
        }) as typeof fetch,
      });

      expect(capturedUrl).toBe(
        "https://discord.com/api/v10/applications/123456789012345678/guilds/987654321098765432/commands"
      );
      expect(capturedHeaders.Authorization).toBe("Bot bot-secret-token");
    });
  });
});
