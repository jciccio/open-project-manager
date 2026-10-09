import { describe, it, expect } from "vitest";
import { parseImportVikunjaArgs } from "../import-vikunja-args";

describe("import-vikunja argument parsing", () => {
  it("parses users, repeated projects and dry run", () => {
    expect(parseImportVikunjaArgs(["--user", "a@example.com", "--project", "2", "--project", "9", "--dry-run"])).toEqual({
      user: "a@example.com",
      projectIds: [2, 9],
      dryRun: true,
    });
  });

  it.each([
    [["--project"], "nothing"],
    [["--project", ""], '""'],
    [["--project", "abc"], '"abc"'],
    [["--project", "0"], '"0"'],
    [["--project", "-3"], '"-3"'],
    [["--project", "2.5"], '"2.5"'],
  ])("rejects %j instead of importing nothing", (argv, shown) => {
    expect(() => parseImportVikunjaArgs(argv)).toThrow(`--project needs a positive integer Vikunja project id, got ${shown}`);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseImportVikunjaArgs(["--projects", "2"])).toThrow("Unknown argument: --projects");
  });
});
