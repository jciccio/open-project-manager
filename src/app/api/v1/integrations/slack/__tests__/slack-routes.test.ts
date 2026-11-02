import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST as eventsHandler } from "../events/route";
import { POST as commandsHandler } from "../commands/route";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";
import { linkSlackUser } from "@/lib/integrations/slack";

describe("Slack Routes", () => {
  let userId: string;
  let projectId: string;
  const testSecret = "test_signing_secret_for_routes";

  beforeEach(async () => {
    const userRes = await createTestUser(`slack-route-user-${Date.now()}`);
    userId = userRes.user.id;
    const project = await createTestProject(userId, "Slack Route Project");
    projectId = project.id;

    await db.column.create({
      data: {
        projectId,
        name: "Backlog",
        group: "BACKLOG",
        order: 1,
      },
    });

    await linkSlackUser("U_ROUTE_TEST", userId);
  });

  afterEach(async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    await cleanupTestUser(userId);
  });

  function makeSlackHeaders(secret: string, body: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sigBasestring = `v0:${timestamp}:${body}`;
    const signature = `v0=${crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex")}`;
    return {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    };
  }

  it("returns 503 when SLACK_SIGNING_SECRET is not configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;

    const reqEvents = new NextRequest("http://localhost/api/v1/integrations/slack/events", {
      method: "POST",
      body: JSON.stringify({ type: "url_verification" }),
    });
    const resEvents = await eventsHandler(reqEvents);
    expect(resEvents.status).toBe(503);

    const reqCommands = new NextRequest("http://localhost/api/v1/integrations/slack/commands", {
      method: "POST",
      body: "command=%2Fopm",
    });
    const resCommands = await commandsHandler(reqCommands);
    expect(resCommands.status).toBe(503);
  });

  it("returns 401 when signature is invalid or missing", async () => {
    process.env.SLACK_SIGNING_SECRET = testSecret;

    const req = new NextRequest("http://localhost/api/v1/integrations/slack/commands", {
      method: "POST",
      body: "command=%2Fopm",
    });
    const res = await commandsHandler(req);
    expect(res.status).toBe(401);
  });

  it("handles Slack url_verification challenge when secret and signature are valid", async () => {
    process.env.SLACK_SIGNING_SECRET = testSecret;
    const jsonBody = JSON.stringify({
      type: "url_verification",
      challenge: "test_slack_challenge_token_xyz",
    });

    const headers = makeSlackHeaders(testSecret, jsonBody);
    const req = new NextRequest("http://localhost/api/v1/integrations/slack/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: jsonBody,
    });

    const res = await eventsHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge).toBe("test_slack_challenge_token_xyz");
  });

  it("processes slash command via form-urlencoded body with valid signature and linked user", async () => {
    process.env.SLACK_SIGNING_SECRET = testSecret;
    const formData = new URLSearchParams({
      command: "/opm",
      text: "new Automated Slack Task",
      user_id: "U_ROUTE_TEST",
      user_name: "testbot",
    });
    const rawBody = formData.toString();

    const headers = makeSlackHeaders(testSecret, rawBody);
    const req = new NextRequest("http://localhost/api/v1/integrations/slack/commands", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: rawBody,
    });

    const res = await commandsHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_type).toBe("in_channel");
    expect(body.text).toContain("Created card");
  });
});
