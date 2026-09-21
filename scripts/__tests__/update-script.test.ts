import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Update Scripts", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const rootUpdateScript = path.join(rootDir, "update.sh");
  const deployUpdateScript = path.join(rootDir, "deploy", "update.sh");

  it("ensures both update scripts exist and are executable", () => {
    expect(fs.existsSync(rootUpdateScript)).toBe(true);
    expect(fs.existsSync(deployUpdateScript)).toBe(true);

    const rootStat = fs.statSync(rootUpdateScript);
    const deployStat = fs.statSync(deployUpdateScript);

    // Verify executable permissions
    expect(rootStat.mode & 0o111).toBeTruthy();
    expect(deployStat.mode & 0o111).toBeTruthy();
  });

  it("passes bash syntax validation for deploy/update.sh", () => {
    expect(() => {
      execSync(`bash -n "${deployUpdateScript}"`);
    }).not.toThrow();
  });

  it("passes bash syntax validation for root update.sh", () => {
    expect(() => {
      execSync(`bash -n "${rootUpdateScript}"`);
    }).not.toThrow();
  });

  it("executes ./update.sh --help successfully from project root", () => {
    const output = execSync(`"${rootUpdateScript}" --help`, { cwd: rootDir }).toString();
    expect(output).toContain("Open Project Manager - Update Utility");
    expect(output).toContain("--list");
    expect(output).toContain("--current");
  });

  it("executes ./update.sh -c returning version tag or commit", () => {
    const output = execSync(`"${rootUpdateScript}" -c`, { cwd: rootDir }).toString();
    expect(output).toContain("Current version:");
  });

  it("protects data and uploads directories in git clean command", () => {
    const content = fs.readFileSync(deployUpdateScript, "utf-8");
    expect(content).toContain('-e "data*"');
    expect(content).toContain('-e "uploads*"');
    expect(content).toContain('-e "dev.db*"');
    expect(content).toContain('-e ".env*"');
  });

  it("contains service user detection and standalone data symlinking", () => {
    const content = fs.readFileSync(deployUpdateScript, "utf-8");
    expect(content).toContain("detect_service_user");
    expect(content).toContain("chown -R");
    expect(content).toContain(".next/standalone/data");
    expect(content).toContain("MAX_ATTEMPTS=30");
  });
});
