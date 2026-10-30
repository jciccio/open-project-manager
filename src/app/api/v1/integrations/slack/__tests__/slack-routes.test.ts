import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as eventsHandler } from "../events/route";
import { POST as commandsHandler } from "../commands/route";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { db } from "@/lib/db";

describe("Slack Routes", () => {
  let userId: string;
  let projectId: string;

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
  });

  afterEach(async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    await cleanupTestUser(userId);
  });

  it("handles Slack url_verification challenge", async () => {
    const req = new NextRequest("http://localhost/api/v1/integrations/slack/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "url_verification",
        challenge: "test_slack_challenge_token_xyz",
      }),
    });

    const res = await eventsHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge).toBe("test_slack_challenge_token_xyz");
  });

  it("processes slash command via form-urlencoded body", async () => {
    const formData = new URLSearchParams({
      command: "/opm",
      text: "new Automated Slack Task",
      user_name: "testbot",
    });

    const req = new NextRequest("http://localhost/api/v1/integrations/slack/commands", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const res = await commandsHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_type).toBe("in_channel");
    expect(body.text).toContain("Created card");
  });
});
