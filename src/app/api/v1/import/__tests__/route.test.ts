import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestUser, cleanupTestUser } from "@/test/helpers";

const runImportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/import/runImport", () => ({ runImport: runImportMock }));

const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => afterTasks.push(task),
}));

import { POST } from "../route";
import { GET as getJob } from "../[jobId]/route";
import { db } from "@/lib/db";
import { STALE_JOB_MS } from "@/lib/import/jobs";

async function runBackgroundWork() {
  while (afterTasks.length > 0) await afterTasks.shift()!();
}

async function jobStatus(token: string, jobId: string) {
  const res = await getJob(
    new NextRequest(`http://localhost/api/v1/import/${jobId}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: Promise.resolve({ jobId }) }
  );
  return { status: res.status, body: await res.json() };
}

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
    afterTasks.length = 0;
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

  it("starts a background job for the configured account and reports it, with per-record errors hidden", async () => {
    const res = await post(owner.token, { source: "vikunja", projectIds: [2] });
    expect(res.status).toBe(202);
    const { jobId, status } = (await res.json()).data;
    expect(status).toBe("RUNNING");

    await runBackgroundWork();
    expect(runImportMock).toHaveBeenCalledWith(expect.anything(), owner.user.id, { dryRun: false, importRunId: jobId });

    const job = await jobStatus(owner.token, jobId);
    expect(job.status).toBe(200);
    expect(job.body.data.status).toBe("DONE");
    expect(job.body.data.summary.records[0].error).toBe("Failed to import this record; see the server log.");
    expect((await db.importJob.findUnique({ where: { id: jobId } }))!.lockKey).toBeNull();
  });

  it("refuses a second import while one is running, naming the running job", async () => {
    const running = await db.importJob.create({
      data: { userId: owner.user.id, source: "vikunja", lockKey: owner.user.id },
    });
    const res = await post(owner.token, { source: "vikunja" });
    expect(res.status).toBe(409);
    expect((await res.json()).jobId).toBe(running.id);
    expect(runImportMock).not.toHaveBeenCalled();
  });

  it("releases the lock of a job that stopped responding and starts a new one", async () => {
    const stale = await db.importJob.create({
      data: {
        userId: owner.user.id,
        source: "vikunja",
        lockKey: owner.user.id,
        heartbeatAt: new Date(Date.now() - STALE_JOB_MS - 1000),
      },
    });
    const res = await post(owner.token, { source: "vikunja" });
    expect(res.status).toBe(202);

    const released = await db.importJob.findUnique({ where: { id: stale.id } });
    expect(released).toMatchObject({ status: "FAILED", lockKey: null });
    await runBackgroundWork();
  });

  it("only shows a job to the account that started it", async () => {
    const res = await post(owner.token, { source: "vikunja" });
    const { jobId } = (await res.json()).data;
    await runBackgroundWork();

    expect((await jobStatus(other.token, jobId)).status).toBe(404);
    expect((await jobStatus(owner.token, jobId)).status).toBe(200);
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

  it("marks the job failed without leaking the error text, and releases the lock", async () => {
    runImportMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:3456"));
    const res = await post(owner.token, { source: "vikunja", projectIds: [2] });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()).data;
    await runBackgroundWork();

    const job = await jobStatus(owner.token, jobId);
    expect(job.body.data).toMatchObject({ status: "FAILED", error: "Import failed; see the server log." });
    expect(JSON.stringify(job.body)).not.toContain("ECONNREFUSED");
    expect((await db.importJob.findUnique({ where: { id: jobId } }))!.lockKey).toBeNull();
  });
});
