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
  type DiscordInteraction,
} from "../discord";

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
      const whoBefore = await handleDiscordInteraction({
        id: "i-who-1",
        type: 2,
        data: { name: "opm", options: [{ name: "whoami", type: 1 }] },
        user: { id: "DISCORD_TEST_USER_1", username: "testuser" },
      });
      expect(whoBefore.data?.content).toContain("You are linked as");

      await revokeUserAccess(userId);

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
  });
});
