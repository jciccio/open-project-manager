---
name: opm
description: Manage and develop tasks in Open Project Manager, move tasks between Kanban columns, list project boards, and post progress comments. Triggers on "/opm", "opm", "kanban", "open project manager", "move card", "develop task".
---

# Open Project Manager (OPM) Skill

This skill allows Antigravity to manage Kanban tasks and columns in Open Project Manager, transitioning cards through stages and guiding implementation.

## Command Reference

### 1. Board Inspection (`/opm list`)
- Fetch active projects via MCP tool `list_projects` (or REST `GET /api/v1/projects`).
- Fetch columns and cards using `get_project` or `list_columns` + `list_cards`.
- Display cards categorized by column (e.g., **Backlog**, **To Do**, **In Progress**, **In Review**, **Done**), displaying card identifier (e.g. `OPM-101`), title, and tags/labels.

### 2. Moving Cards (`/opm move <card> <column>`)
- Resolve card by identifier or ID via `get_card_by_identifier` or `get_card`.
- Match the target column name case-insensitively (e.g. "In Progress", "Review", "Done").
- Invoke MCP tool `move_card({ cardId, columnId })` or `PATCH /api/v1/cards/{cardId}`.
- Confirm card transition to the user.

### 3. Developing Features (`/opm develop <card>`)
When beginning work on a card:
1. Retrieve card requirements, description, and checklists (`get_card` or `get_card_by_identifier`).
2. Move card to the active development column ("In Progress").
3. Call `add_comment` with: `Started development via Antigravity.`
4. Summarize the user story, acceptance criteria, and components to be modified.
5. Enter implementation flow: research relevant code, create implementation plan if needed, implement changes, verify tests, and suggest moving card to "In Review" or "Done".

### 4. Progress Notes (`/opm comment <card> <message>`)
- Post updates to the card via `add_comment({ cardId, content })` or `POST /api/v1/cards/{cardId}/comments`.

## Connectivity Options

### 1. MCP Server Integration (Recommended)
Register the Open Project Manager MCP server in Antigravity (`mcp_config.json`):
```json
{
  "mcpServers": {
    "open-project-manager": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/open-project-manager/scripts/mcp-server.ts"]
    }
  }
}
```
Available MCP tools:
`list_projects`, `get_project`, `list_columns`, `list_cards`, `get_card`, `get_card_by_identifier`, `create_card`, `update_card`, `move_card`, `add_comment`, `add_card_relation`.

### 2. REST API Integration
For remote instances:
- Set `OPM_BASE_URL` (e.g. `http://localhost:3000` or `https://opm.example.com`)
- Set `OPM_API_TOKEN` (Bearer token generated from OPM user settings)
- Use standard HTTP calls against `/api/v1/...`
