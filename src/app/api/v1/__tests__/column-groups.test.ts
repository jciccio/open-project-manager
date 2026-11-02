import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createColumnRoute } from "../projects/[id]/columns/route";
import { PUT as updateColumnRoute } from "../columns/[id]/route";
import { GET as listCardsRoute } from "../cards/route";
import { createTestUser, cleanupTestUser, createTestProject, createTestCard } from "@/test/helpers";
import { db } from "@/lib/db";

describe("REST API: column state groups", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  function jsonRequest(url: string, method: string, body: unknown) {
    return new NextRequest(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function createColumn(body: Record<string, unknown>) {
    const res = await createColumnRoute(
      jsonRequest(`http://localhost/api/v1/projects/${projectId}/columns`, "POST", body),
      { params: Promise.resolve({ id: projectId }) }
    );
    return { status: res.status, body: await res.json() };
  }

  async function updateColumn(id: string, body: Record<string, unknown>) {
    const res = await updateColumnRoute(jsonRequest(`http://localhost/api/v1/columns/${id}`, "PUT", body), {
      params: Promise.resolve({ id }),
    });
    return { status: res.status, body: await res.json() };
  }

  async function listCards(query: string) {
    const res = await listCardsRoute(
      new NextRequest(`http://localhost/api/v1/cards?projectId=${projectId}&${query}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    return { status: res.status, body: await res.json() };
  }

  beforeEach(async () => {
    const res = await createTestUser(`api-column-groups-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
    projectId = (await createTestProject(userId, "Column Groups API")).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("creates a column with a group, color and description", async () => {
    const { status, body } = await createColumn({
      name: "Won't Do",
      group: "CANCELLED",
      color: "#ef4444",
      description: "Closed without doing",
    });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({
      group: "CANCELLED",
      isDone: false,
      color: "#ef4444",
      description: "Closed without doing",
    });
  });

  it("applies isDone and group sent to PUT /columns/:id", async () => {
    const column = (await createColumn({ name: "Review" })).body.data;
    expect(column).toMatchObject({ group: "UNSTARTED", isDone: false });

    const done = await updateColumn(column.id, { isDone: true });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ group: "COMPLETED", isDone: true });

    const started = await updateColumn(column.id, { group: "STARTED", description: "In review" });
    expect(started.body.data).toMatchObject({ group: "STARTED", isDone: false, description: "In review" });
  });

  it("returns 400 for an unknown group or a conflicting isDone", async () => {
    const unknown = await createColumn({ name: "QA", group: "DONE" });
    expect(unknown.status).toBe(400);

    const column = (await createColumn({ name: "QA" })).body.data;
    const conflict = await updateColumn(column.id, { group: "CANCELLED", isDone: true });
    expect(conflict.status).toBe(400);
  });

  it("filters GET /cards by column group", async () => {
    const started = (await createColumn({ name: "Doing", group: "STARTED" })).body.data;
    const cancelled = (await createColumn({ name: "Dropped", group: "CANCELLED" })).body.data;
    const backlog = (await createColumn({ name: "Later", group: "BACKLOG" })).body.data;
    const doing = await createTestCard(projectId, started.id, "Doing card");
    const dropped = await createTestCard(projectId, cancelled.id, "Dropped card");
    await createTestCard(projectId, backlog.id, "Later card");

    const one = await listCards("columnGroup=STARTED");
    expect(one.status).toBe(200);
    expect(one.body.data.map((c: { id: string }) => c.id)).toEqual([doing.id]);

    const many = await listCards("columnGroup=started,cancelled");
    expect(many.body.data.map((c: { id: string }) => c.id).sort()).toEqual([doing.id, dropped.id].sort());

    const invalid = await listCards("columnGroup=DONE");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("DONE");
  });

  it("leaves the stored row consistent: isDone true exactly when the group is COMPLETED", async () => {
    const column = (await createColumn({ name: "Ship", group: "COMPLETED" })).body.data;
    await updateColumn(column.id, { isDone: false });
    const row = await db.column.findUnique({ where: { id: column.id } });
    expect(row).toMatchObject({ group: "UNSTARTED", isDone: false });
  });
});
