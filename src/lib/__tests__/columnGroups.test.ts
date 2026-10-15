import { describe, it, expect } from "vitest";
import {
  GROUP_CONFLICTS_WITH_IS_DONE_ERROR,
  isClosedColumn,
  isClosedGroup,
  parseColumnGroupFilter,
  resolveColumnGroup,
} from "@/lib/columnGroups";
import { parseColumnCreate, parseColumnUpdate } from "@/lib/validation/columns";

describe("resolveColumnGroup", () => {
  it("derives isDone from the group", () => {
    expect(resolveColumnGroup({ group: "COMPLETED" })).toEqual({ success: true, group: "COMPLETED", isDone: true });
    expect(resolveColumnGroup({ group: "CANCELLED" })).toEqual({ success: true, group: "CANCELLED", isDone: false });
    expect(resolveColumnGroup({ group: "STARTED" }, "COMPLETED")).toEqual({
      success: true,
      group: "STARTED",
      isDone: false,
    });
  });

  it("maps isDone alone onto a group, keeping a non-completed group when isDone is false", () => {
    expect(resolveColumnGroup({ isDone: true }, "BACKLOG")).toEqual({ success: true, group: "COMPLETED", isDone: true });
    expect(resolveColumnGroup({ isDone: false }, "COMPLETED")).toEqual({
      success: true,
      group: "UNSTARTED",
      isDone: false,
    });
    expect(resolveColumnGroup({ isDone: false }, "CANCELLED")).toEqual({
      success: true,
      group: "CANCELLED",
      isDone: false,
    });
  });

  it("keeps the existing group when neither field is given, and defaults new columns to UNSTARTED", () => {
    expect(resolveColumnGroup({}, "STARTED")).toEqual({ success: true, group: "STARTED", isDone: false });
    expect(resolveColumnGroup({}, "COMPLETED")).toEqual({ success: true, group: "COMPLETED", isDone: true });
    expect(resolveColumnGroup({})).toEqual({ success: true, group: "UNSTARTED", isDone: false });
  });

  it("rejects an isDone that disagrees with the group", () => {
    expect(resolveColumnGroup({ group: "CANCELLED", isDone: true })).toEqual({
      success: false,
      error: GROUP_CONFLICTS_WITH_IS_DONE_ERROR,
    });
    expect(resolveColumnGroup({ group: "COMPLETED", isDone: false })).toEqual({
      success: false,
      error: GROUP_CONFLICTS_WITH_IS_DONE_ERROR,
    });
    expect(resolveColumnGroup({ group: "COMPLETED", isDone: true }).success).toBe(true);
  });
});

describe("closed columns", () => {
  it("treats COMPLETED and CANCELLED as closed", () => {
    expect(isClosedGroup("COMPLETED")).toBe(true);
    expect(isClosedGroup("CANCELLED")).toBe(true);
    expect(isClosedGroup("STARTED")).toBe(false);
    expect(isClosedGroup(undefined)).toBe(false);
  });

  it("treats a column as closed when isDone is set even if its group lags behind", () => {
    expect(isClosedColumn({ group: "UNSTARTED", isDone: true })).toBe(true);
    expect(isClosedColumn({ group: "CANCELLED", isDone: false })).toBe(true);
    expect(isClosedColumn({ group: "STARTED", isDone: false })).toBe(false);
    expect(isClosedColumn({ isDone: false })).toBe(false);
  });
});

describe("parseColumnGroupFilter", () => {
  it("accepts one group, a comma-separated list, or an array, case-insensitively", () => {
    expect(parseColumnGroupFilter("started")).toEqual({ success: true, groups: ["STARTED"] });
    expect(parseColumnGroupFilter("BACKLOG, unstarted")).toEqual({ success: true, groups: ["BACKLOG", "UNSTARTED"] });
    expect(parseColumnGroupFilter(["COMPLETED", "CANCELLED"])).toEqual({
      success: true,
      groups: ["COMPLETED", "CANCELLED"],
    });
  });

  it("rejects unknown and empty groups", () => {
    const unknown = parseColumnGroupFilter("STARTED,DONE");
    expect(unknown.success).toBe(false);
    if (!unknown.success) expect(unknown.error).toContain("'DONE'");
    expect(parseColumnGroupFilter("").success).toBe(false);
    expect(parseColumnGroupFilter([]).success).toBe(false);
  });
});

describe("column input validation", () => {
  it("accepts a full create payload and resolves its group", () => {
    const parsed = parseColumnCreate({ name: " QA ", group: "STARTED", color: "#ff0000", description: "Review" });
    expect(parsed).toMatchObject({
      success: true,
      group: "STARTED",
      isDone: false,
      data: { name: "QA", color: "#ff0000", description: "Review" },
    });
  });

  it("rejects an unknown group, a non-hex color and an over-long description", () => {
    const badGroup = parseColumnCreate({ name: "QA", group: "DONE" });
    expect(badGroup.success).toBe(false);
    if (!badGroup.success) expect(badGroup.error).toContain("group");

    const badColor = parseColumnUpdate({ color: "red" }, "UNSTARTED");
    expect(badColor.success).toBe(false);
    if (!badColor.success) expect(badColor.error).toContain("Color must be a hex value");

    const longDescription = parseColumnUpdate({ description: "x".repeat(2_001) }, "UNSTARTED");
    expect(longDescription.success).toBe(false);
  });

  it("lets an update clear color and description with null", () => {
    const parsed = parseColumnUpdate({ color: null, description: null }, "STARTED");
    expect(parsed).toMatchObject({ success: true, group: "STARTED", data: { color: null, description: null } });
  });
});
