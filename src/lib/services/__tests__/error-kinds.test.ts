import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { serviceErrorStatus } from "@/lib/api/serviceErrorResponse";

const SERVICES_DIR = path.join(__dirname, "..");

describe("service error kinds", () => {
  it("maps each kind to its HTTP status, and a result without a kind to 400", () => {
    expect(serviceErrorStatus("unauthenticated")).toBe(401);
    expect(serviceErrorStatus("forbidden")).toBe(403);
    expect(serviceErrorStatus("not_found")).toBe(404);
    expect(serviceErrorStatus("invalid")).toBe(400);
    expect(serviceErrorStatus("conflict")).toBe(409);
    expect(serviceErrorStatus("internal")).toBe(500);
    expect(serviceErrorStatus(undefined)).toBe(400);
  });

  it("gives every failure a service returns a kind", () => {
    const missing: string[] = [];
    for (const file of readdirSync(SERVICES_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(path.join(SERVICES_DIR, file), "utf8");
      source.split("\n").forEach((line, index) => {
        if (/success: false\b/.test(line) && !/\bkind: /.test(line) && !/^\s*(\/\/|\*|export (type|interface))/.test(line)) {
          missing.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(missing).toEqual([]);
  });
});
