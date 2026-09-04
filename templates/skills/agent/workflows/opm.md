---
description: Manage Open Project Manager tasks, inspect Kanban boards, move cards across columns, and develop features.
---

Open Project Manager workflow for Kanban board interactions and task lifecycle development.

**Input**: The command arguments after `/opm` (e.g. `list`, `move PROJ-10 "In Progress"`, `develop PROJ-10`, `comment PROJ-10 "Finished API endpoints"`).

---

## Instructions

### Step 1: Parse the user command

Evaluate the arguments provided:
- If empty or `help`: Show quick overview of `/opm` capabilities (`list`, `move`, `develop`, `comment`).
- If `list`: Go to Step 2.
- If `move <card> <column>`: Go to Step 3.
- If `develop <card>`: Go to Step 4.
- If `comment <card> <message>`: Go to Step 5.

### Step 2: List Tasks and Kanban Columns (`/opm list`)
1. Fetch projects using MCP tool `list_projects` or `GET /api/v1/projects`.
2. Retrieve the active board's columns and cards using `get_project` or `list_columns` + `list_cards`.
3. Format output clearly by Kanban column:
   - **Backlog**: Cards waiting for triage
   - **To Do**: Prioritized tasks ready to begin
   - **In Progress**: Active work
   - **In Review**: Completed code undergoing verification
   - **Done**: Shipped tasks
4. List card identifiers, titles, and labels.

### Step 3: Move a Card (`/opm move`)
1. Retrieve card using `get_card_by_identifier` or `get_card`.
2. Resolve target column name against project columns (case-insensitive fuzzy match).
3. If not found, list available project columns and prompt for clarification.
4. Call `move_card` with `cardId` and target `columnId`.
5. Report successful transition to user.

### Step 4: Develop a Task Card (`/opm develop`)
1. Fetch full card details including description, acceptance criteria, and checklists.
2. Locate the active development column ("In Progress").
3. Move the card to "In Progress" with `move_card`.
4. Add a progress comment via `add_comment`: `Started development via Antigravity.`
5. Present the task breakdown to the user.
6. Enter standard development cycle:
   - Identify relevant project files
   - Plan necessary code changes
   - Implement and run tests
   - When verified, suggest moving the card to "In Review" or "Done".

### Step 5: Post a Comment (`/opm comment`)
1. Resolve card identifier.
2. Call `add_comment` with the provided text.
3. Confirm to user.
