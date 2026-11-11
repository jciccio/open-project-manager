import { describe, it, expect } from "vitest";
import { parseCreateUserArgs } from "../create-user-args";

describe("create-user argument parsing", () => {
  it("parses email and name", () => {
    expect(parseCreateUserArgs(["--email", "jose@example.com", "--name", "Jose C"])).toEqual({
      email: "jose@example.com",
      name: "Jose C",
    });
  });

  it("defaults the name to the email's local part", () => {
    expect(parseCreateUserArgs(["--email", "jose@example.com"])).toEqual({ email: "jose@example.com", name: "jose" });
  });

  it("requires an email", () => {
    expect(() => parseCreateUserArgs(["--name", "Jose"])).toThrow("--email is required");
  });

  it.each([
    [["--email"], "--email"],
    [["--email", " "], "--email"],
    [["--email", "--name", "Jose"], "--email"],
    [["--email", "a@b.c", "--name"], "--name"],
  ])("rejects %j with no value", (argv, flag) => {
    expect(() => parseCreateUserArgs(argv)).toThrow(`${flag} needs a value`);
  });

  it("rejects unknown arguments, including a password", () => {
    expect(() => parseCreateUserArgs(["--email", "a@b.c", "--password", "x"])).toThrow("Unknown argument: --password");
  });
});
