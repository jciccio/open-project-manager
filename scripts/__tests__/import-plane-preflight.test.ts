import { describe, it, expect } from "vitest";
import { projectKeyProblems } from "../import-plane-preflight";

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
