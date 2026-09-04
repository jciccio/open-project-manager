import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  installSkills,
  parseCliArgs,
  getMcpSnippet,
  getEnvSnippet,
} from "../install-skills";

describe("install-skills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opm-skills-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("parseCliArgs", () => {
    it("parses defaults correctly", () => {
      const opts = parseCliArgs([]);
      expect(opts.assistant).toBe("all");
      expect(opts.scope).toBe("project");
      expect(opts.connection).toBe("mcp");
    });

    it("parses flags correctly", () => {
      const opts = parseCliArgs([
        "--assistant",
        "claude",
        "--global",
        "--connection",
        "api",
        "--target",
        "/custom/path",
      ]);
      expect(opts.assistant).toBe("claude");
      expect(opts.scope).toBe("global");
      expect(opts.connection).toBe("api");
      expect(opts.target).toBe("/custom/path");
    });

    it("handles short flags like --claude and --antigravity", () => {
      expect(parseCliArgs(["--claude"]).assistant).toBe("claude");
      expect(parseCliArgs(["--antigravity"]).assistant).toBe("antigravity");
      expect(parseCliArgs(["--all"]).assistant).toBe("all");
      expect(parseCliArgs(["--project"]).scope).toBe("project");
    });
  });

  describe("snippets", () => {
    it("generates MCP configuration with correct script path", () => {
      const snippet = getMcpSnippet("/custom/opm") as {
        mcpServers: { "open-project-manager": { command: string; args: string[] } };
      };
      expect(snippet.mcpServers["open-project-manager"].command).toBe("npx");
      expect(snippet.mcpServers["open-project-manager"].args).toContain(
        path.resolve("/custom/opm", "scripts", "mcp-server.ts")
      );
    });

    it("generates REST API env snippet", () => {
      const snippet = getEnvSnippet("http://192.168.1.50:3000");
      expect(snippet).toContain("OPM_BASE_URL=http://192.168.1.50:3000");
      expect(snippet).toContain("OPM_API_TOKEN=");
    });
  });

  describe("installSkills", () => {
    it("installs Claude files only when assistant=claude", async () => {
      const result = await installSkills({
        assistant: "claude",
        target: tempDir,
        scope: "project",
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".claude", "commands", "opm.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".claude", "skills", "opm", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".agents"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, ".agent"))).toBe(false);
    });

    it("installs Antigravity files only when assistant=antigravity", async () => {
      const result = await installSkills({
        assistant: "antigravity",
        target: tempDir,
        scope: "project",
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".agents", "skills", "opm", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".agent", "workflows", "opm.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".claude"))).toBe(false);
    });

    it("installs both Claude and Antigravity when assistant=all", async () => {
      const result = await installSkills({
        assistant: "all",
        target: tempDir,
        scope: "project",
        connection: "api",
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".claude", "commands", "opm.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".claude", "skills", "opm", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".agents", "skills", "opm", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".agent", "workflows", "opm.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, ".env.opm"))).toBe(true);
    });
  });
});
