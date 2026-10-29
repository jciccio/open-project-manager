import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createCardRoute } from "../cards/route";
import { PUT as updateCardRoute } from "../cards/[id]/route";
import { POST as reorderRoute } from "../cards/reorder/route";
import { POST as createViewRoute } from "../views/route";
import { PUT as updateViewRoute } from "../views/[id]/route";
import { POST as createCardTypeRoute } from "../card-types/route";
import { PUT as updateCardTypeRoute } from "../card-types/[id]/route";
import {
  cleanupTestUser,
  createTestCard,
  createTestCardType,
  createTestColumn,
  createTestProject,
  createTestUser,
} from "@/test/helpers";
import { db } from "@/lib/db";

describe("REST API input validation", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let columnId: string;

  function jsonRequest(path: string, method: string, body: unknown) {
    return new NextRequest(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function read(res: Response) {
    return { status: res.status, body: await res.json() };
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeEach(async () => {
    const res = await createTestUser(`api-validation-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
    projectId = (await createTestProject(userId, "Validation API")).id;
    columnId = (await createTestColumn(projectId)).id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("POST /cards returns 400 naming an unknown priority", async () => {
    const { status, body } = await read(
      await createCardRoute(jsonRequest("/cards", "POST", { projectId, columnId, title: "Card", priority: "SOON" }))
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/^priority: /);
  });

  it("PUT /cards/:id returns 400 for a non-numeric points value", async () => {
    const card = await createTestCard(projectId, columnId);
    const { status, body } = await read(
      await updateCardRoute(jsonRequest(`/cards/${card.id}`, "PUT", { points: "five" }), params(card.id))
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/^points: /);
  });

  it("POST /cards/reorder returns 400 for a bad item or an unknown body key", async () => {
    const card = await createTestCard(projectId, columnId);
    const badItem = await read(
      await reorderRoute(jsonRequest("/cards/reorder", "POST", { items: [{ id: card.id, order: "first" }] }))
    );
    expect(badItem.status).toBe(400);
    expect(badItem.body.error).toMatch(/^items\.0\.order: /);

    const unknownKey = await read(
      await reorderRoute(jsonRequest("/cards/reorder", "POST", { items: [{ id: card.id, order: 1 }], bogus: true }))
    );
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error).toContain("bogus");
  });

  it("POST and PUT /views return 400 for filterJson that is not a JSON object", async () => {
    const created = await read(
      await createViewRoute(jsonRequest("/views", "POST", { projectId, name: "View", filterJson: "[]" }))
    );
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/^filterJson: /);

    const view = await db.savedView.create({ data: { projectId, name: "Existing", filterJson: "{}" } });
    const updated = await read(
      await updateViewRoute(jsonRequest(`/views/${view.id}`, "PUT", { filterJson: "{oops" }), params(view.id))
    );
    expect(updated.status).toBe(400);
    expect(updated.body.error).toMatch(/^filterJson: /);
  });

  it("POST and PUT /card-types return 400 for a bad color or empty icon", async () => {
    const created = await read(
      await createCardTypeRoute(jsonRequest("/card-types", "POST", { projectId, name: "Story", color: "blue" }))
    );
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/^color: /);

    const type = await createTestCardType(projectId);
    const updated = await read(
      await updateCardTypeRoute(jsonRequest(`/card-types/${type.id}`, "PUT", { icon: "" }), params(type.id))
    );
    expect(updated.status).toBe(400);
    expect(updated.body.error).toMatch(/^icon: /);
  });
});
