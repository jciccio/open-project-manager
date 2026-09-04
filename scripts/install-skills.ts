#!/usr/bin/env npx tsx

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

export interface InstallOptions {
  assistant?: "claude" | "antigravity" | "all";
  scope?: "project" | "global";
  target?: string;
  connection?: "mcp" | "api";
  silent?: boolean;
}

export interface InstalledFile {
  src: string;
  dest: string;
  assistant: "claude" | "antigravity";
}

export interface InstallResult {
  success: boolean;
  targetDir: string;
  scope: "project" | "global";
  installedFiles: InstalledFile[];
  mcpSnippet?: Record<string, unknown>;
  envSnippet?: string;
  message: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_ROOT = path.resolve(REPO_ROOT, "templates", "skills");

export function getMcpSnippet(opmPath: string = REPO_ROOT): Record<string, unknown> {
  const mcpScriptPath = path.resolve(opmPath, "scripts", "mcp-server.ts");
  return {
    mcpServers: {
      "open-project-manager": {
        command: "npx",
        args: ["-y", "tsx", mcpScriptPath],
      },
    },
  };
}

export function getEnvSnippet(baseUrl: string = "http://localhost:3000"): string {
  return [
    "# Open Project Manager Assistant Integration",
    `OPM_BASE_URL=${baseUrl}`,
    "OPM_API_TOKEN=replace_with_your_user_api_token",
    "",
  ].join("\n");
}

export async function installSkills(options: InstallOptions = {}): Promise<InstallResult> {
  const assistant = options.assistant || "all";
  const scope = options.scope || "project";
  const connection = options.connection || "mcp";
  const homeDir = os.homedir();

  const targetDir = path.resolve(
    options.target ? options.target : scope === "global" ? homeDir : process.cwd()
  );

  const installedFiles: InstalledFile[] = [];

  // 1. Claude installation
  if (assistant === "claude" || assistant === "all") {
    const claudeCommandsDir =
      scope === "global"
        ? path.join(homeDir, ".claude", "commands")
        : path.join(targetDir, ".claude", "commands");
    const claudeSkillsDir =
      scope === "global"
        ? path.join(homeDir, ".claude", "skills", "opm")
        : path.join(targetDir, ".claude", "skills", "opm");

    fs.mkdirSync(claudeCommandsDir, { recursive: true });
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    const claudeCommandSrc = path.join(TEMPLATES_ROOT, "claude", "commands", "opm.md");
    const claudeCommandDest = path.join(claudeCommandsDir, "opm.md");
    if (fs.existsSync(claudeCommandSrc)) {
      fs.copyFileSync(claudeCommandSrc, claudeCommandDest);
      installedFiles.push({ src: claudeCommandSrc, dest: claudeCommandDest, assistant: "claude" });
    }

    const claudeSkillSrc = path.join(TEMPLATES_ROOT, "claude", "skills", "opm", "SKILL.md");
    const claudeSkillDest = path.join(claudeSkillsDir, "SKILL.md");
    if (fs.existsSync(claudeSkillSrc)) {
      fs.copyFileSync(claudeSkillSrc, claudeSkillDest);
      installedFiles.push({ src: claudeSkillSrc, dest: claudeSkillDest, assistant: "claude" });
    }
  }

  // 2. Antigravity installation
  if (assistant === "antigravity" || assistant === "all") {
    const agSkillsDir =
      scope === "global"
        ? path.join(homeDir, ".gemini", "config", "skills", "opm")
        : path.join(targetDir, ".agents", "skills", "opm");
    const agWorkflowsDir =
      scope === "global"
        ? path.join(homeDir, ".agent", "workflows")
        : path.join(targetDir, ".agent", "workflows");

    fs.mkdirSync(agSkillsDir, { recursive: true });
    fs.mkdirSync(agWorkflowsDir, { recursive: true });

    const agSkillSrc = path.join(TEMPLATES_ROOT, "agents", "skills", "opm", "SKILL.md");
    const agSkillDest = path.join(agSkillsDir, "SKILL.md");
    if (fs.existsSync(agSkillSrc)) {
      fs.copyFileSync(agSkillSrc, agSkillDest);
      installedFiles.push({ src: agSkillSrc, dest: agSkillDest, assistant: "antigravity" });
    }

    const agWorkflowSrc = path.join(TEMPLATES_ROOT, "agent", "workflows", "opm.md");
    const agWorkflowDest = path.join(agWorkflowsDir, "opm.md");
    if (fs.existsSync(agWorkflowSrc)) {
      fs.copyFileSync(agWorkflowSrc, agWorkflowDest);
      installedFiles.push({ src: agWorkflowSrc, dest: agWorkflowDest, assistant: "antigravity" });
    }
  }

  const mcpSnippet = getMcpSnippet(REPO_ROOT);
  const envSnippet = getEnvSnippet();

  if (connection === "api") {
    const envPath = path.join(targetDir, ".env.opm");
    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(envPath, envSnippet, "utf-8");
    }
  }

  return {
    success: true,
    targetDir,
    scope,
    installedFiles,
    mcpSnippet,
    envSnippet,
    message: `Installed OPM skills for ${assistant} (${scope} scope) into ${targetDir}`,
  };
}

export function parseCliArgs(args: string[]): InstallOptions {
  const options: InstallOptions = {
    assistant: "all",
    scope: "project",
    connection: "mcp",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--assistant" && args[i + 1]) {
      const val = args[++i].toLowerCase();
      if (val === "claude" || val === "antigravity" || val === "all") {
        options.assistant = val;
      }
    } else if (arg === "--claude") {
      options.assistant = "claude";
    } else if (arg === "--antigravity") {
      options.assistant = "antigravity";
    } else if (arg === "--all") {
      options.assistant = "all";
    } else if (arg === "--scope" && args[i + 1]) {
      const val = args[++i].toLowerCase();
      if (val === "project" || val === "global") {
        options.scope = val;
      }
    } else if (arg === "--global") {
      options.scope = "global";
    } else if (arg === "--project") {
      options.scope = "project";
    } else if (arg === "--target" && args[i + 1]) {
      options.target = args[++i];
    } else if (arg === "--connection" && args[i + 1]) {
      const val = args[++i].toLowerCase();
      if (val === "mcp" || val === "api") {
        options.connection = val;
      }
    } else if (arg === "--silent") {
      options.silent = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Open Project Manager Skill Installer

Usage:
  npx tsx scripts/install-skills.ts [options]
  yarn install-skills [options]

Options:
  --assistant <claude|antigravity|all>   Target AI assistant (default: all)
  --claude                              Shortcut for --assistant claude
  --antigravity                         Shortcut for --assistant antigravity
  --all                                 Shortcut for --assistant all
  --scope <project|global>              Installation scope (default: project)
  --global                              Shortcut for --scope global
  --project                             Shortcut for --scope project
  --target <path>                       Custom destination path (defaults to cwd or home)
  --connection <mcp|api>                Preferred connection mode (default: mcp)
  --silent                              Suppress verbose console output
  --help, -h                            Show this help menu
`);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  console.log("🚀 Installing Open Project Manager skills...");
  const result = await installSkills(options);

  console.log(`\n✔ ${result.message}`);
  console.log("\nFiles installed:");
  for (const item of result.installedFiles) {
    console.log(`  - [${item.assistant}] ${item.dest}`);
  }

  console.log("\n--- Next Steps ---");
  if (options.connection === "mcp") {
    console.log("Add this MCP configuration to your assistant (claude.json or mcp_config.json):");
    console.log(JSON.stringify(result.mcpSnippet, null, 2));
  } else {
    console.log("Configure your .env.opm with your Open Project Manager URL and user API token:");
    console.log(result.envSnippet);
  }
  console.log("Now you can run /opm in Claude Code or Antigravity to manage tasks!\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error("Installation failed:", err);
    process.exit(1);
  });
}
