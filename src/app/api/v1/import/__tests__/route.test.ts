import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

const runImportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/import/runImport", () => ({ runImport: runImportMock }));

import { POST } from "../route";

function post(token: string, body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/v1/import", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/v1/import", () => {
  const originalEnv = { ...process.env };
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    owner = await createTestUser(`import-owner-${Date.now()}`);
    other = await createTestUser(`import-other-${Date.now()}`);
    process.env.VIKUNJA_URL = "http://vikunja.example.invalid/api/v1";
    process.env.VIKUNJA_API_TOKEN = "server-token";
    process.env.VIKUNJA_IMPORT_USER_EMAIL = owner.user.email.toUpperCase();
    runImportMock.mockReset();
    runImportMock.mockResolvedValue({
      mode: "live",
      importRunId: "run-1",
      totals: { created: 0, skipped: 0, failed: 1 },
      records: [{ entityType: "card", sourceId: "vikunja:task:1", status: "failed", error: "Prisma P2002 on Card.number" }],
    });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await cleanupTestUser(owner.user.id);
    await cleanupTestUser(other.user.id);
  });

  it("refuses accounts other than VIKUNJA_IMPORT_USER_EMAIL", async () => {
    const res = await post(other.token, { source: "vikunja" });
    expect(res.status).toBe(403);
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it("refuses everyone when VIKUNJA_IMPORT_USER_EMAIL is unset", async () => {
    delete process.env.VIKUNJA_IMPORT_USER_EMAIL;
    const res = await post(owner.token, { source: "vikunja" });
    expect(res.status).toBe(403);
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it("runs for the configured account and hides per-record error details", async () => {
    const res = await post(owner.token, { source: "vikunja", projectIds: [2] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.records[0].error).toBe("Failed to import this record; see the server log.");
    expect(runImportMock).toHaveBeenCalledWith(expect.anything(), owner.user.id, { dryRun: false });
  });

  it("rejects inherited property names as a source", async () => {
    for (const source of ["constructor", "__proto__", "toString"]) {
      const res = await post(owner.token, { source });
      expect(res.status, source).toBe(400);
    }
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it("rejects a string dryRun and an empty or non-integer projectIds", async () => {
    for (const body of [
      { source: "vikunja", dryRun: "true" },
      { source: "vikunja", projectIds: [] },
      { source: "vikunja", projectIds: [1.5] },
      { source: "vikunja", projectIds: [0] },
    ]) {
      const res = await post(owner.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it("does not leak the error text when the import throws", async () => {
    runImportMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:3456"));
    const res = await post(owner.token, { source: "vikunja", projectIds: [2] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Import failed; see the server log.");
  });
});
