import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../projects/[id]/route";
import { getProjectById } from "@/lib/services/projects";
import { createTestUser, cleanupTestUser, createTestProject } from "@/test/helpers";

const RAW_MESSAGE = "SQLITE_ERROR: secret table detail";

const getProjectAccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  getProjectAccess.mockImplementation(actual.getProjectAccess);
  return { ...actual, getProjectAccess };
});

describe("loading a project that fails", () => {
  let userId: string;
  let token: string;
  let projectId: string;

  const get = (id: string) =>
    GET(new NextRequest(`http://localhost/api/v1/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } }), {
      params: Promise.resolve({ id }),
    });

  beforeEach(async () => {
    const res = await createTestUser(`project-load-${Date.now()}`);
    userId = res.user.id;
    token = res.token;
    projectId = (await createTestProject(userId, "Load Failure")).id;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUser(userId);
  });

  it("marks a thrown error as internal, and a missing project as not found", async () => {
    getProjectAccess.mockRejectedValueOnce(new Error(RAW_MESSAGE));
    expect(await getProjectById(projectId, userId)).toMatchObject({ success: false, kind: "internal" });

    const missing = await getProjectById("does-not-exist", userId);
    expect(missing.success).toBe(false);
    expect(missing.kind).toBe("not_found");
  });

  it("returns 500 over REST without the raw exception text", async () => {
    getProjectAccess.mockRejectedValueOnce(new Error(RAW_MESSAGE));

    const res = await get(projectId);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_MESSAGE);
  });

  it("still returns 404 for a project that doesn't exist or isn't accessible", async () => {
    expect((await get("does-not-exist")).status).toBe(404);

    const other = await createTestUser(`project-load-other-${Date.now()}`);
    const otherProject = await createTestProject(other.user.id, "Other");
    expect((await get(otherProject.id)).status).toBe(404);
    await cleanupTestUser(other.user.id);
  });

  it("still returns the project when it loads", async () => {
    const res = await get(projectId);
    expect(res.status).toBe(200);
  });
});
