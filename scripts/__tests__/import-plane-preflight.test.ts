import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { ImportProject } from "@/lib/import/types";
import { cleanupTestUser, createTestProject, createTestUser } from "@/test/helpers";
import { findKeyProblems, projectKeyProblems } from "../import-plane-preflight";

const NONE = new Set<string>();

describe("projectKeyProblems", () => {
  it("passes a key of exactly the supported length that is free", () => {
    expect(projectKeyProblems([{ sourceId: "p1", key: "ABCDEF" }], NONE, NONE)).toEqual([]);
  });

  it("flags a key OPM would cut", () => {
    expect(projectKeyProblems([{ sourceId: "p1", key: "ABCDEFG" }], NONE, NONE)).toEqual([
      expect.stringContaining("ABCDEFG: OPM keys are limited to 6 characters"),
    ]);
  });

  it("flags a key already taken, ignoring case", () => {
    expect(projectKeyProblems([{ sourceId: "p1", key: "lab" }], new Set(["LAB"]), NONE)).toEqual([
      expect.stringContaining("LAB: this account already has a project"),
    ]);
  });

  it("accepts a project this source already imported, since its key is its own", () => {
    expect(projectKeyProblems([{ sourceId: "p1", key: "LAB" }], new Set(["LAB"]), new Set(["p1"]))).toEqual([]);
  });

  it("reports every problem, not only the first", () => {
    const problems = projectKeyProblems(
      [
        { sourceId: "p1", key: "LAB" },
        { sourceId: "p2", key: "OK" },
        { sourceId: "p3", key: "LONGIDENTIFIER" },
      ],
      new Set(["LAB"]),
      NONE
    );
    expect(problems).toHaveLength(2);
  });
});

describe("findKeyProblems", () => {
  const SOURCE = "plane:plane.test/my-team";
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser(`preflight-${Date.now()}`)).user.id;
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  function importerOf(projects: ImportProject[]) {
    return {
      name: SOURCE,
      async *fetchProjects() {
        yield* projects;
      },
    };
  }

  async function recordImport(sourceId: string, localId: string) {
    await db.importRecord.create({
      data: { userId, source: SOURCE, entityType: "project", sourceId, localId, importRunId: "run-1" },
    });
  }

  it("flags a taken key when the project's import record points at a deleted project", async () => {
    const deleted = await createTestProject(userId, "Old Alpha", "OLD");
    await recordImport("p1", deleted.id);
    await db.project.delete({ where: { id: deleted.id } });
    await createTestProject(userId, "Another Alpha", "ALPHA");

    const problems = await findKeyProblems(importerOf([{ sourceId: "p1", name: "Alpha", key: "ALPHA" }]), userId);

    expect(problems).toEqual([expect.stringContaining("ALPHA: this account already has a project")]);
  });

  it("accepts a project whose import record still points at an existing project", async () => {
    const imported = await createTestProject(userId, "Beta", "BETA");
    await recordImport("p2", imported.id);

    expect(await findKeyProblems(importerOf([{ sourceId: "p2", name: "Beta", key: "BETA" }]), userId)).toEqual([]);
  });

  it("ignores import records from another source", async () => {
    const imported = await createTestProject(userId, "Beta", "BETA");
    await db.importRecord.create({
      data: { userId, source: "vikunja:other", entityType: "project", sourceId: "p2", localId: imported.id, importRunId: "run-1" },
    });

    expect(await findKeyProblems(importerOf([{ sourceId: "p2", name: "Beta", key: "BETA" }]), userId)).toEqual([
      expect.stringContaining("BETA: this account already has a project"),
    ]);
  });
});
