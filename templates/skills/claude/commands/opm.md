---
name: "OPM: Open Project Manager"
description: Interact with Open Project Manager Kanban boards, move tasks across columns, and develop features.
category: Project Management
tags: [opm, kanban, tasks, agile]
---

Open Project Manager assistant interface for managing Kanban tasks, columns, and feature development.

**Input**: Subcommand and arguments passed after `/opm` (e.g. `/opm list`, `/opm move <card> <column>`, `/opm develop <card>`, `/opm comment <card> <message>`, `/opm help`).

---

## Instructions for the Assistant

Parse the arguments following `/opm`:

### 1. `/opm` or `/opm help`
Display the available OPM commands and connection status:
- `/opm list [project]`: List Kanban columns and their task cards.
- `/opm move <card_id_or_identifier> <column_name>`: Move a task card to another column (e.g., "To Do", "In Progress", "In Review", "Done").
- `/opm develop <card_id_or_identifier>`: Start development on a task. Fetches requirements, moves the card to "In Progress", adds a status comment, and guides implementation.
- `/opm comment <card_id_or_identifier> <message>`: Add a comment or progress update to a card.
- Check and report if OPM MCP tools (`list_projects`, `list_cards`, etc.) or REST API credentials (`OPM_BASE_URL` and `OPM_API_TOKEN`) are configured.

### 2. `/opm list [project]`
1. Check available projects using MCP `list_projects` or `GET /api/v1/projects`.
2. If no project argument was given and multiple projects exist, list them or ask which project to view. If only one active project exists, use it automatically.
3. Fetch the columns and cards using `get_project` or `list_columns` + `list_cards`.
4. Display the Kanban board cleanly in columns (e.g., **Backlog**, **To Do**, **In Progress**, **In Review**, **Done**), showing each card's identifier (e.g., `PROJ-42`), title, and priority/labels.

### 3. `/opm move <card> <column>`
1. Resolve the card by ID or identifier (e.g., `PROJ-15` or UUID) using `get_card_by_identifier` or `get_card`.
2. Find the target column in the project (case-insensitive fuzzy match: e.g. "progress" matches "In Progress", "done" matches "Done").
3. If target column is not found, list available columns in the project and ask the user to clarify.
4. Move the card using MCP `move_card` (`cardId`, `columnId`) or `PATCH /api/v1/cards/{id}`.
5. Confirm the move with the user (e.g. "✓ Moved PROJ-15 to 'In Progress'").

### 4. `/opm develop <card>`
1. Resolve and fetch the full card details (title, description, checklists, labels, related tasks).
2. Find the "In Progress" (or active development) column in the card's project.
3. Move the card to "In Progress" using MCP `move_card` or REST API.
4. Add a comment to the card indicating development has begun by the AI assistant:
   `Started development via Claude Code.`
5. Present a clear summary of the task requirements, acceptance criteria, and checklist items.
6. Formulate an actionable implementation plan and ask the user if they'd like to proceed with the code changes.

### 5. `/opm comment <card> <message>`
1. Resolve the card ID.
2. Call MCP `add_comment` or `POST /api/v1/cards/{id}/comments` with the message.
3. Confirm to the user that the comment was posted.

---

## Connection Protocol
- **Primary (MCP Server):** When MCP tools `list_projects`, `get_project`, `list_cards`, `get_card`, `move_card`, `add_comment` are registered in the session, use them.
- **Secondary (REST API):** If MCP tools are unavailable, check environment variables `OPM_BASE_URL` (default `http://localhost:3000`) and `OPM_API_TOKEN`. Make HTTP requests using `curl` with header `Authorization: Bearer $OPM_API_TOKEN`.
