---
name: opm
description: Manage and develop tasks in Open Project Manager, move tasks between Kanban columns, list cards, and post comments. Triggers on "/opm", "opm", "kanban", "project manager card", "move card".
---

# Open Project Manager (OPM) Skill

This skill allows Claude Code to directly interact with Open Project Manager (OPM) boards, columns, and task cards.

## Available Actions

### 1. Listing Projects and Kanban Boards
- **MCP Tool:** `list_projects`, `get_project({ id })`, or `list_columns({ projectId })` + `list_cards({ projectId })`
- **REST API:**
  - `GET /api/v1/projects`
  - `GET /api/v1/projects/{projectId}/columns`
  - `GET /api/v1/projects/{projectId}/cards`
- **Display Guidelines:**
  - Render cards organized by their column name in order of column position.
  - Include task identifier (e.g. `PROJ-12`), task title, assignee, and priority.

### 2. Moving Cards Between Columns
- **MCP Tool:** `move_card({ cardId, columnId, newOrder? })`
- **REST API:** `PATCH /api/v1/cards/{cardId}` with JSON `{ "columnId": "<columnId>" }`
- **Resolution Strategy:**
  - Match column names leniently and case-insensitively (e.g., "in progress", "doing", "progress" -> column with name "In Progress").
  - If ambiguous or not found, list available columns in the project and ask the user.

### 3. Developing a Task Card (`/opm develop <card>`)
When the user wants to start working on a task:
1. **Fetch Details:** Query `get_card` or `get_card_by_identifier` to read description, acceptance criteria, checklists, and labels.
2. **Move to In Progress:** Find the active development column ("In Progress" or equivalent) and call `move_card`.
3. **Log Progress:** Call `add_comment` with a note: `Started development via Claude Code.`
4. **Context Loading:** Present the problem statement, checklist items, and files/components referenced in the card.
5. **Implementation:** Plan and propose changes, implement them in the codebase, and verify tests.
6. **Completion:** When finished and verified, prompt the user to move the card to "Done" or "In Review".

### 4. Card Comments and Status Updates
- **MCP Tool:** `add_comment({ cardId, content })`
- **REST API:** `POST /api/v1/cards/{cardId}/comments` with JSON `{ "content": "<message>" }`

## Authentication & Connection Modes

### Mode A: Model Context Protocol (MCP)
If the project has an active MCP server connection (`open-project-manager` MCP server), tools are directly available. Tool names:
- `list_projects`
- `get_project`
- `list_columns`
- `list_cards`
- `get_card`
- `get_card_by_identifier`
- `create_card`
- `update_card`
- `move_card`
- `add_comment`

### Mode B: REST API Fallback
When running without MCP tool registration:
- Base URL: `${OPM_BASE_URL:-http://localhost:3000}`
- Headers: `Authorization: Bearer ${OPM_API_TOKEN}`, `Content-Type: application/json`
- Use `curl` or node script to query the endpoints.
