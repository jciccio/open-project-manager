import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST as eventsHandler } from "../events/route";
import { POST as commandsHandler } from "../commands/route";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";
import { linkSlackUser } from "@/lib/integrations/slack";
import { proxy } from "@/proxy";

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
    vi.restoreAllMocks();
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
    expect(body.response_type).toBe("ephemeral");
    expect(body.text).toContain("Created card");
  });

  it("acknowledges immediately and dispatches command result via response_url when provided", async () => {
    process.env.SLACK_SIGNING_SECRET = testSecret;
    const responseUrl = "https://hooks.slack.com/commands/T0001/B0001/secret-token";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const formData = new URLSearchParams({
      command: "/opm",
      text: "new Deferred Slack Card",
      user_id: "U_ROUTE_TEST",
      response_url: responseUrl,
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
    expect(body.response_type).toBe("ephemeral");
    expect(body.text).toContain("Processing command");

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe(responseUrl);
    expect(init?.method).toBe("POST");
    const callbackPayload = JSON.parse(String(init?.body));
    expect(callbackPayload.response_type).toBe("ephemeral");
    expect(callbackPayload.text).toContain("Created card");
    expect(callbackPayload.text).toContain("Deferred Slack Card");
  });

  it("rejects non-Slack or non-HTTPS response_url values with 400", async () => {
    process.env.SLACK_SIGNING_SECRET = testSecret;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    for (const badUrl of [
      "http://hooks.slack.com/commands/123",
      "https://evil.example.com/hook",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      const formData = new URLSearchParams({
        command: "/opm",
        text: "help",
        user_id: "U_ROUTE_TEST",
        response_url: badUrl,
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
      expect(res.status).toBe(400);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows Slack routes through the proxy middleware without cookie or authorization header", async () => {
    const reqCommands = new NextRequest("http://localhost:3000/api/v1/integrations/slack/commands", {
      method: "POST",
    });
    const resCommands = await proxy(reqCommands);
    expect(resCommands.status).not.toBe(401);

    const reqEvents = new NextRequest("http://localhost:3000/api/v1/integrations/slack/events", {
      method: "POST",
    });
    const resEvents = await proxy(reqEvents);
    expect(resEvents.status).not.toBe(401);
  });
});
