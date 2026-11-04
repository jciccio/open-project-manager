import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getCardsRoute, POST as createCardRoute } from "../cards/route";
import { GET as getCardsCountRoute } from "../cards/count/route";
import { NextRequest } from "next/server";
import { createTestUser, createTestProject, createTestColumn, cleanupTestUser } from "@/test/helpers";
import { getProjectById } from "@/lib/services/projects";
import { createScopedLabel } from "@/lib/scopedLabels";
import { db } from "@/lib/db";

describe("REST API: Rich Card Filters & Counts (#135)", () => {
  let userId: string;
  let token: string;
  let projectId: string;
  let colTodoId: string;
  let colDoneId: string;
  let labelBugId: string;
  let labelFeatureId: string;

  beforeEach(async () => {
    const res = await createTestUser(`api-rf-${Date.now()}`);
    userId = res.user.id;
    token = res.token;

    const project = await createTestProject(userId, "REST Filter Project");
    projectId = project.id;

    const colTodo = await createTestColumn(projectId, "To Do", 0);
    colTodoId = colTodo.id;
    const colDone = await createTestColumn(projectId, "Done", 1);
    colDoneId = colDone.id;
    await db.column.update({
      where: { id: colDoneId },
      data: { isDone: true, group: "COMPLETED" },
    });

    const bugLabel = await createScopedLabel({
      name: "Bug",
      color: "#ef4444",
      projectId,
      userId: null,
    });
    labelBugId = bugLabel.id;

    const featureLabel = await createScopedLabel({
      name: "Feature",
      color: "#3b82f6",
      projectId,
      userId: null,
    });
    labelFeatureId = featureLabel.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  function authGet(url: string) {
    return getCardsRoute(
      new NextRequest(url, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
  }

  function authGetCount(url: string) {
    return getCardsCountRoute(
      new NextRequest(url, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
  }

  async function postCard(data: any) {
    const res = await createCardRoute(
      new NextRequest("http://localhost/api/v1/cards", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      })
    );
    const body = await res.json();
    return body.data;
  }

  it("filters cards by labelIds", async () => {
    const c1 = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Bug Task",
      labelIds: [labelBugId],
    });
    const c2 = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Feature Task",
      labelIds: [labelFeatureId],
    });
    await postCard({
      projectId,
      columnId: colTodoId,
      title: "No Label Task",
    });

    const resBug = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&labelIds=${labelBugId}`);
    const dataBug = await resBug.json();
    expect(dataBug.data.length).toBe(1);
    expect(dataBug.data[0].id).toBe(c1.id);

    const resBoth = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&labelIds=${labelBugId},${labelFeatureId}`);
    const dataBoth = await resBoth.json();
    expect(dataBoth.data.length).toBe(2);
  });

  it("filters cards by dueBefore, dueAfter, and isOverdue", async () => {
    const pastDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();
    const todayStr = new Date().toISOString().split("T")[0];

    const pastCard = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Overdue Item",
      dueDate: pastDate,
    });
    const futureCard = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Upcoming Item",
      dueDate: futureDate,
    });
    const completedPastCard = await postCard({
      projectId,
      columnId: colDoneId,
      title: "Completed Item with past due date",
      dueDate: pastDate,
    });

    const resBefore = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&dueBefore=${todayStr}`);
    const dataBefore = await resBefore.json();
    expect(dataBefore.data.map((c: any) => c.id)).toContain(pastCard.id);
    expect(dataBefore.data.map((c: any) => c.id)).toContain(completedPastCard.id);

    const resAfter = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&dueAfter=${todayStr}`);
    const dataAfter = await resAfter.json();
    expect(dataAfter.data.map((c: any) => c.id)).toEqual([futureCard.id]);

    const resOverdue = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&isOverdue=true`);
    const dataOverdue = await resOverdue.json();
    expect(dataOverdue.data.map((c: any) => c.id)).toContain(pastCard.id);
    expect(dataOverdue.data.map((c: any) => c.id)).not.toContain(futureCard.id);
    expect(dataOverdue.data.map((c: any) => c.id)).not.toContain(completedPastCard.id);
  });

  it("filters cards by hasParent", async () => {
    const parent = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Root Card",
    });
    const subtask = await postCard({
      projectId,
      columnId: colTodoId,
      title: "Sub Card",
      parentId: parent.id,
    });

    const resRoot = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&hasParent=false`);
    const dataRoot = await resRoot.json();
    expect(dataRoot.data.some((c: any) => c.id === parent.id)).toBe(true);
    expect(dataRoot.data.some((c: any) => c.id === subtask.id)).toBe(false);

    const resSub = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&hasParent=true`);
    const dataSub = await resSub.json();
    expect(dataSub.data.some((c: any) => c.id === parent.id)).toBe(false);
    expect(dataSub.data.some((c: any) => c.id === subtask.id)).toBe(true);
  });

  it("supports orderBy and orderDirection", async () => {
    await postCard({
      projectId,
      columnId: colTodoId,
      title: "First by Date",
      dueDate: "2026-02-01T00:00:00Z",
    });
    await postCard({
      projectId,
      columnId: colTodoId,
      title: "Second by Date",
      dueDate: "2026-08-01T00:00:00Z",
    });

    const resAsc = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=due&orderDirection=asc`);
    const dataAsc = await resAsc.json();
    expect(dataAsc.data[0].title).toBe("First by Date");
    expect(dataAsc.data[1].title).toBe("Second by Date");

    const resDesc = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=due&orderDirection=desc`);
    const dataDesc = await resDesc.json();
    expect(dataDesc.data[0].title).toBe("Second by Date");
    expect(dataDesc.data[1].title).toBe("First by Date");

    // Test priority sorting by severity
    await postCard({ projectId, columnId: colTodoId, title: "Card None", priority: "NONE" });
    await postCard({ projectId, columnId: colTodoId, title: "Card Low", priority: "LOW" });
    await postCard({ projectId, columnId: colTodoId, title: "Card High", priority: "HIGH" });
    await postCard({ projectId, columnId: colTodoId, title: "Card Urgent", priority: "URGENT" });

    const resPrioDesc = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=priority&orderDirection=desc`);
    const dataPrioDesc = await resPrioDesc.json();
    const priosDesc = dataPrioDesc.data.map((c: any) => c.priority);
    expect(priosDesc.indexOf("URGENT")).toBeLessThan(priosDesc.indexOf("HIGH"));
    expect(priosDesc.indexOf("HIGH")).toBeLessThan(priosDesc.indexOf("LOW"));
    expect(priosDesc.indexOf("LOW")).toBeLessThan(priosDesc.indexOf("NONE"));

    const resPrioAsc = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=priority&orderDirection=asc`);
    const dataPrioAsc = await resPrioAsc.json();
    const priosAsc = dataPrioAsc.data.map((c: any) => c.priority);
    expect(priosAsc.indexOf("NONE")).toBeLessThan(priosAsc.indexOf("LOW"));
    expect(priosAsc.indexOf("LOW")).toBeLessThan(priosAsc.indexOf("HIGH"));
    expect(priosAsc.indexOf("HIGH")).toBeLessThan(priosAsc.indexOf("URGENT"));
  });

  it("rejects cursor pagination when orderBy is not 'order'", async () => {
    const res = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=priority&after=somecursor`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cursor pagination is only supported with orderBy=order");
  });

  it("omits nextCursor when sorting by non-order fields even if more rows exist", async () => {
    await postCard({ projectId, columnId: colTodoId, title: "Card 1" });
    await postCard({ projectId, columnId: colTodoId, title: "Card 2" });

    const res = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=priority&limit=1`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.nextCursor).toBeNull();
  });

  it("counts cards via GET /api/v1/cards?count=true and GET /api/v1/cards/count", async () => {
    await postCard({
      projectId,
      columnId: colTodoId,
      title: "Task 1",
      priority: "HIGH",
      labelIds: [labelBugId],
    });
    await postCard({
      projectId,
      columnId: colTodoId,
      title: "Task 2",
      priority: "HIGH",
    });
    await postCard({
      projectId,
      columnId: colDoneId,
      title: "Task 3",
      priority: "LOW",
    });

    // 1. GET /api/v1/cards?count=true
    const resCount = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&count=true`);
    const dataCount = await resCount.json();
    expect(dataCount.success).toBe(true);
    expect(dataCount.count).toBe(3);

    // 2. GET /api/v1/cards?count=true&groupBy=priority
    const resGrouped = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&count=true&groupBy=priority`);
    const dataGrouped = await resGrouped.json();
    expect(dataGrouped.groups.find((g: any) => g.priority === "HIGH").count).toBe(2);
    expect(dataGrouped.groups.find((g: any) => g.priority === "LOW").count).toBe(1);

    // 3. GET /api/v1/cards/count
    const resEndpointCount = await authGetCount(`http://localhost/api/v1/cards/count?projectId=${projectId}`);
    const dataEndpointCount = await resEndpointCount.json();
    expect(dataEndpointCount.success).toBe(true);
    expect(dataEndpointCount.count).toBe(3);

    // 4. GET /api/v1/cards/count?groupBy=column
    const resEndpointCol = await authGetCount(`http://localhost/api/v1/cards/count?projectId=${projectId}&groupBy=column`);
    const dataEndpointCol = await resEndpointCol.json();
    expect(dataEndpointCol.groups.find((g: any) => g.columnId === colTodoId).count).toBe(2);
    expect(dataEndpointCol.groups.find((g: any) => g.columnId === colDoneId).count).toBe(1);
  });

  it("returns 400 on invalid query parameters", async () => {
    const invalidDate = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&dueBefore=invalid-date`);
    expect(invalidDate.status).toBe(400);

    const invalidOrderBy = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=bad_field`);
    expect(invalidOrderBy.status).toBe(400);

    const invalidGroupBy = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&count=true&groupBy=bad_group`);
    expect(invalidGroupBy.status).toBe(400);

    const invalidHasParent = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&hasParent=maybe`);
    expect(invalidHasParent.status).toBe(400);

    const emptyColGroup = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&columnGroup=`);
    expect(emptyColGroup.status).toBe(400);
  });

  it("walks pages with desc cursor pagination across tied order values", async () => {
    // Create cards with tied order values
    for (let i = 0; i < 4; i++) {
      await db.card.create({
        data: {
          projectId,
          columnId: colTodoId,
          number: 100 + i,
          title: `Tied Card ${i}`,
          order: 10,
        },
      });
    }

    const page1Res = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=order&orderDirection=desc&limit=2`);
    expect(page1Res.status).toBe(200);
    const page1 = await page1Res.json();
    expect(page1.data.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    const page2Res = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=order&orderDirection=desc&limit=2&cursor=${page1.nextCursor}`);
    expect(page2Res.status).toBe(200);
    const page2 = await page2Res.json();
    expect(page2.data.length).toBe(2);

    const page1Ids = page1.data.map((c: any) => c.id);
    const page2Ids = page2.data.map((c: any) => c.id);
    // Disjoint pages
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it("places null due dates last in both asc and desc due sorts", async () => {
    const today = new Date();
    await postCard({ projectId, columnId: colTodoId, title: "Undated Card", dueDate: null });
    await postCard({ projectId, columnId: colTodoId, title: "Dated Card", dueDate: today.toISOString() });

    const ascRes = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=due&orderDirection=asc`);
    const ascData = await ascRes.json();
    expect(ascData.data[0].title).toBe("Dated Card");
    expect(ascData.data[1].title).toBe("Undated Card");

    const descRes = await authGet(`http://localhost/api/v1/cards?projectId=${projectId}&orderBy=due&orderDirection=desc`);
    const descData = await descRes.json();
    expect(descData.data[0].title).toBe("Dated Card");
    expect(descData.data[1].title).toBe("Undated Card");
  });
});
