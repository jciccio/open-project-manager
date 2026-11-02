import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listLabelsRoute, POST as createLabelRoute } from "../labels/route";
import { PUT as updateLabelRoute } from "../labels/[id]/route";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";

describe("REST API: label descriptions", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  function jsonRequest(url: string, method: string, body: unknown, authToken = token) {
    return new NextRequest(url, {
      method,
      headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function updateLabel(id: string, body: unknown, authToken = token) {
    const res = await updateLabelRoute(jsonRequest(`http://localhost/api/v1/labels/${id}`, "PUT", body, authToken), {
      params: Promise.resolve({ id }),
    });
    return { status: res.status, body: await res.json() };
  }

  beforeEach(async () => {
    const res = await createTestUser(`api-label-descriptions-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
    projectId = (await createTestProject(userId, "Label Descriptions API")).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("creates a label with a description and lists it back", async () => {
    const created = await createLabelRoute(
      jsonRequest("http://localhost/api/v1/labels", "POST", {
        name: "spike",
        color: "#8b5cf6",
        projectId,
        description: "Research only; findings go in a comment",
      })
    );
    expect(created.status).toBe(201);
    const label = (await created.json()).data;
    expect(label.description).toBe("Research only; findings go in a comment");

    const listed = await listLabelsRoute(
      new NextRequest(`http://localhost/api/v1/labels?projectId=${projectId}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    const labels = (await listed.json()).data as { id: string; description: string | null }[];
    expect(labels.find((l) => l.id === label.id)?.description).toBe("Research only; findings go in a comment");
  });

  it("updates color and description with PUT /labels/:id", async () => {
    const created = await createLabelRoute(
      jsonRequest("http://localhost/api/v1/labels", "POST", { name: "review", color: "#3b82f6", projectId })
    );
    const label = (await created.json()).data;

    const updated = await updateLabel(label.id, { color: "#22c55e", description: "Needs a second pair of eyes" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: "review", color: "#22c55e", description: "Needs a second pair of eyes" });

    const invalid = await updateLabel(label.id, { color: "green" });
    expect(invalid.status).toBe(400);

    const malformed = await updateLabel(label.id, "{not json");
    expect(malformed.status).toBe(400);
  });

  it("refuses PUT on another user's label", async () => {
    const created = await createLabelRoute(
      jsonRequest("http://localhost/api/v1/labels", "POST", { name: "private", color: "#3b82f6", projectId })
    );
    const label = (await created.json()).data;

    const other = await createTestUser(`api-label-other-${Date.now()}`);
    try {
      const res = await updateLabel(label.id, { description: "hijacked" }, other.token);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unauthorized");
    } finally {
      await cleanupTestUser(other.user.id);
    }
  });
});
