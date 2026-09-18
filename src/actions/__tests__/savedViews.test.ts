import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProject, cleanupTestUser } from "@/test/helpers";
import { getSavedViews, createSavedView, updateSavedView, deleteSavedView } from "@/lib/services/views";

describe("Saved Views Actions", () => {
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    const userRes = await createTestUser(`savedview-user-${Date.now()}`);
    userId = userRes.user.id;

    const project = await createTestProject(userId, "Saved Views Test Project");
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  it("creates, fetches, updates, and deletes saved views", async () => {
    // 1. Create a saved view
    const filterJson = JSON.stringify({ priority: "HIGH", query: "bug", viewMode: "list" });
    const createRes = await createSavedView(
      projectId,
      {
        name: "High Priority Bugs",
        filterJson,
        isDefault: false,
      },
      userId
    );
    expect(createRes.success).toBe(true);
    expect(createRes.data?.name).toBe("High Priority Bugs");
    expect(createRes.data?.filterJson).toBe(filterJson);
    const viewId = createRes.data!.id;

    // 2. Fetch saved views
    const listRes = await getSavedViews(projectId, userId);
    expect(listRes.success).toBe(true);
    expect(listRes.data?.length).toBe(1);
    expect(listRes.data![0].id).toBe(viewId);

    // 3. Update saved view
    const updateRes = await updateSavedView(
      viewId,
      {
        name: "Critical Bugs",
        isDefault: true,
      },
      userId
    );
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Critical Bugs");
    expect(updateRes.data?.isDefault).toBe(true);

    // 4. Delete saved view
    const deleteRes = await deleteSavedView(viewId, userId);
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.deletedId).toBe(viewId);

    const postDeleteList = await getSavedViews(projectId, userId);
    expect(postDeleteList.data?.length).toBe(0);
  });

  it("handles default view switching cleanly", async () => {
    const view1 = await createSavedView(
      projectId,
      { name: "View 1", isDefault: true },
      userId
    );
    expect(view1.data?.isDefault).toBe(true);

    const view2 = await createSavedView(
      projectId,
      { name: "View 2", isDefault: true },
      userId
    );
    expect(view2.data?.isDefault).toBe(true);

    const list = await getSavedViews(projectId, userId);
    const v1 = list.data?.find((v) => v.name === "View 1");
    const v2 = list.data?.find((v) => v.name === "View 2");
    expect(v1?.isDefault).toBe(false);
    expect(v2?.isDefault).toBe(true);
  });

  it("rejects unauthorized access", async () => {
    const otherUser = await createTestUser(`other-${Date.now()}`);
    const res = await createSavedView(
      projectId,
      { name: "Unauthorized View" },
      otherUser.user.id
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Project not found or access denied");

    await cleanupTestUser(otherUser.user.id);
  });
});
