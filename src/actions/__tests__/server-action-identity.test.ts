import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

describe("Server Action identity", () => {
  it("never lets a caller override the session user", () => {
    const actionsDir = path.join(__dirname, "..");
    const offenders = readdirSync(actionsDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(path.join(actionsDir, file), "utf8");
        return source.trimStart().startsWith('"use server"') && /overrideUserId/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
