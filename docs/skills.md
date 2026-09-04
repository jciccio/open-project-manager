# AI Assistant Skills & Commands (Claude Code & Antigravity)

Open Project Manager provides first-class integrations with AI coding assistants like **Claude Code** and **Antigravity**. By installing the OPM skills bundle, your assistant gains dedicated `/opm` slash commands to inspect Kanban boards, transition tasks across columns, and autonomously manage the development lifecycle of features and bug fixes.

---

## 🚀 Quick Install

From your project directory or within the Open Project Manager repository, run:

```bash
# Install for both Claude Code and Antigravity into the current project
yarn install-skills

# Or using npx tsx directly:
npx tsx scripts/install-skills.ts
```

### Installation Options

| Flag | Description | Default |
|------|-------------|---------|
| `--assistant <claude\|antigravity\|all>` | Target assistant | `all` |
| `--claude` | Install only for Claude Code (`.claude/`) | - |
| `--antigravity` | Install only for Antigravity (`.agents/` & `.agent/`) | - |
| `--scope <project\|global>` | Project-local directory vs global user config | `project` |
| `--global` | Install globally (`~/.claude/` and `~/.gemini/config/skills/`) | - |
| `--target <path>` | Install into custom directory | current working directory |
| `--connection <mcp\|api>` | Generate MCP config or `.env.opm` REST template | `mcp` |

---

## 🔌 Connection Setup

### Option 1: Model Context Protocol (MCP) — Recommended

If you are developing locally or have access to the Open Project Manager codebase, configure the MCP server in your assistant's settings.

#### For Claude Code (`claude.json`):
```json
{
  "mcpServers": {
    "open-project-manager": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/path/to/open-project-manager/scripts/mcp-server.ts"
      ]
    }
  }
}
```

#### For Antigravity (`mcp_config.json`):
```json
{
  "mcpServers": {
    "open-project-manager": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/path/to/open-project-manager/scripts/mcp-server.ts"
      ]
    }
  }
}
```

### Option 2: REST API (Remote / Docker Deployments)

When connecting your AI assistant to a remote Open Project Manager server:
1. Generate an API token from **User Settings -> API Tokens** in the OPM web UI.
2. In your project, configure `.env.opm` or export environment variables:
   ```env
   OPM_BASE_URL="http://localhost:3000"
   OPM_API_TOKEN="opm_tok_..."
   ```

---

## 🛠️ `/opm` Slash Commands

Once installed, use `/opm` in Claude Code or Antigravity:

### 1. View Help and Status
```bash
/opm
/opm help
```
Displays connection health, active project, and all available subcommands.

### 2. View Kanban Board & Columns
```bash
/opm list
# Or list a specific project:
/opm list <project-id>
```
Lists columns in order (e.g. **Backlog**, **To Do**, **In Progress**, **In Review**, **Done**) along with active task identifiers, titles, priority, and labels.

### 3. Move Cards Between Columns
```bash
/opm move <card-identifier> <column-name>
```
Examples:
- `/opm move PROJ-42 "In Progress"`
- `/opm move PROJ-42 Done`
- `/opm move PROJ-42 Backlog`

Matching is case-insensitive. If a column name is ambiguous or not found, the assistant presents the project's valid column names for selection.

### 4. Develop a Task Card (`/opm develop`)
```bash
/opm develop <card-identifier>
```
The `/opm develop` command automates the entire development onboarding loop:
1. Retrieves task description, requirements, checklists, and labels.
2. Transitions the card to **In Progress**.
3. Adds a comment on the card: `Started development via Claude Code` (or Antigravity).
4. Loads the relevant codebase context and presents an actionable implementation plan.
5. Guides code changes and verification, prompting to move the card to **In Review** or **Done** when completed.

### 5. Add Progress Comments
```bash
/opm comment <card-identifier> <message>
```
Examples:
- `/opm comment PROJ-42 "Added API endpoints and unit tests."`
- `/opm comment PROJ-42 "Blocked waiting for design approval."`

---

## 📁 File Structure

When installed into a repository:
```text
.
├── .claude/
│   ├── commands/
│   │   └── opm.md              # Claude Code /opm command prompt
│   └── skills/
│       └── opm/
│           └── SKILL.md        # Claude Code skill definition
├── .agents/
│   └── skills/
│       └── opm/
│           └── SKILL.md        # Antigravity skill specification
└── .agent/
    └── workflows/
        └── opm.md              # Antigravity /opm workflow
```
