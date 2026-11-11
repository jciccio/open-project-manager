import { describe, it, expect } from "vitest";
import { parseImportPlaneArgs } from "../import-plane-args";

describe("import-plane argument parsing", () => {
  it("parses workspace, user and repeated projects", () => {
    expect(
      parseImportPlaneArgs(["--workspace", "my-team", "--user", "a@example.com", "--project", "ABC", "--project", "XYZ", "--dry-run"])
    ).toEqual({ workspace: "my-team", user: "a@example.com", projectIdentifiers: ["ABC", "XYZ"], dryRun: true, emailMap: {} });
  });

  it("parses repeated --map-email pairs", () => {
    const { emailMap } = parseImportPlaneArgs([
      "--workspace",
      "my-team",
      "--map-email",
      "a@plane.test=a@opm.test",
      "--map-email",
      "b@plane.test=b@opm.test",
    ]);
    expect(emailMap).toEqual({ "a@plane.test": "a@opm.test", "b@plane.test": "b@opm.test" });
  });

  it.each(["a@plane.test", "=a@opm.test", "a@plane.test=", "a=b=c"])("rejects the --map-email value %j", (value) => {
    expect(() => parseImportPlaneArgs(["--workspace", "my-team", "--map-email", value])).toThrow("--map-email needs");
  });

  it("runs live unless --dry-run is passed", () => {
    expect(parseImportPlaneArgs(["--workspace", "my-team"]).dryRun).toBe(false);
  });

  it("requires a workspace", () => {
    expect(() => parseImportPlaneArgs(["--dry-run"])).toThrow("--workspace needs a Plane workspace slug");
  });

  it.each([
    [["--workspace"], "--workspace"],
    [["--project", " ", "--dry-run"], "--project"],
    [["--user"], "--user"],
  ])("rejects %j with no value", (argv, flag) => {
    expect(() => parseImportPlaneArgs(argv)).toThrow(`${flag} needs a value`);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseImportPlaneArgs(["--projects", "ABC"])).toThrow("Unknown argument: --projects");
  });
});
