# Open Project Manager 🚀

A lightweight, fast, and self-hosted project management web application inspired by Vikunja. Built with **Next.js 15+ (App Router)**, **TypeScript**, **Tailwind CSS**, and **SQLite / PostgreSQL + Prisma ORM (v7)**.

[![CircleCI](https://img.shields.io/circleci/build/github/jciccio/open-project-manager/main?logo=circleci)](https://circleci.com/gh/jciccio/open-project-manager)
[![Tests](https://img.shields.io/badge/tests-55%20passed-emerald?logo=vitest)](https://github.com/jciccio/open-project-manager)
[![Downloads](https://img.shields.io/github/downloads/jciccio/open-project-manager/total?logo=github&label=downloads)](https://github.com/jciccio/open-project-manager/releases)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/jciccio/open-project-manager)
[![MCP Native](https://img.shields.io/badge/MCP-native-7C3AED)](https://github.com/jciccio/open-project-manager)
[![Stack](https://img.shields.io/badge/Stack-Next.js%2015%20%7C%20TypeScript%20%7C%20SQLite%20%26%20Postgres%20%7C%20Prisma%207-indigo)](https://github.com/jciccio/open-project-manager)

---
<img width="1512" height="731" alt="Screenshot 2026-08-09 at 12 28 28 PM" src="https://github.com/user-attachments/assets/bbf583f6-7c34-419c-82c6-4e44a71c7361" />
<img width="1512" height="657" alt="Screenshot 2026-08-09 at 12 32 36 PM" src="https://github.com/user-attachments/assets/ea71ba27-8c15-4263-bcad-0b8c46313f5c" />

<img width="794" height="696" alt="Screenshot 2026-08-09 at 12 32 23 PM" src="https://github.com/user-attachments/assets/9c81cd08-8fe2-486b-8a17-da6df13bbc31" />
<img width="1511" height="700" alt="Screenshot 2026-08-09 at 12 35 04 PM" src="https://github.com/user-attachments/assets/33e3e52b-d7b5-4c37-8066-a3c245ee2a2d" />
<img width="1507" height="717" alt="Screenshot 2026-08-09 at 12 34 24 PM" src="https://github.com/user-attachments/assets/32dc835d-e0ee-427c-beff-f3735a12a733" />


---

## ✨ Features

- 🔒 **User Authentication & API Token Management**: Password login, profile settings, and revocable machine/API tokens for external scripts and LLMs.
- 🌐 **Multi-Language Support (i18n)**: Switch between English (`EN`) and Spanish (`ES`) locales with persistent preference.
- 🔌 **Programmatic REST API (`/api/v1/*`)**: Comprehensive REST API with Bearer token authentication for full card, project, column, comment, and attachment automation.
- 🤖 **Model Context Protocol (MCP)**: Built-in stdio transport and REST JSON-RPC endpoint for AI agents (Claude, Cursor, Antigravity) to query and manage cards.
- 🎨 **Dark & Light Mode Switcher**: Seamless theme switcher with persistent user preference.
- 📊 **Multiple Project Views**: Switch between Kanban Board, Structured List View, Analytics & Graphs (Recharts), and Monthly Calendar View.
- 🏷️ **Human-Friendly Card Identifiers**: Stable per-project human keys (`PROJ-123`) with instant lookup API (`GET /api/v1/cards/by-identifier/:id`).
- 📁 **Project & Card Archiving**: Archive completed projects or individual cards (`isArchived: true`) to maintain clean active views.
- 📋 **Customizable & Reorganizable Board Columns**: Create custom columns and reorder columns left/right with instant SQLite persistence.
- 🎯 **Rich Task Card Metadata**:
  - **Story Points**: Track task estimation points.
  - **Priority Levels**: Explicit `NONE`, `LOW`, `MEDIUM`, `HIGH`, or `URGENT` priorities.
  - **Assignees & Owners**: Assign team members to cards.
  - **Labels**: Tag cards with project-scoped or global color-coded labels (e.g. Frontend, Backend, Bug).
  - **Due Dates & Completion Timestamps**: Set deadlines and automatically track completion timestamps when cards reach done columns.
- 🔗 **Card Dependencies & Relations**: Connect cards with `BLOCKS`, `BLOCKED_BY`, and `RELATES_TO` relationship links.
- 📎 **File Attachments**: Upload, stream, list, and delete card attachments (documents, images, logs) via UI, REST API, and base64 MCP tools.
- 📄 **Card Cursoring & Pagination**: Cursor-based pagination (`limit` & `cursor`) for large project card listings.
- 💬 **In-Place Comment Editing & Feeds**: Discuss tasks and edit comments in-place across UI, REST API (`PATCH /api/v1/comments/:id`), and MCP tools.
- 🐳 **Official Docker Image & Compose**: Multi-stage `Dockerfile` standalone build and single-command `docker-compose.yml` (SQLite) & `docker-compose.postgres.yml` (PostgreSQL) orchestration with automated migration bootstrapping.
- 🪶 **Flexible Database Engine**: Single `.sqlite` file database stored locally (`dev.db`) by default, with opt-in PostgreSQL support via connection string (`DATABASE_URL=postgresql://...`).

---

## 📊 System Benchmarks & Memory Load Testing

Open Project Manager is profiled using Node process memory inspecting APIs (`process.memoryUsage()`) and real-time stress testing.

### 1. Idle & Baseline Memory Metrics
| Resource / Metric | Benchmark Value | Description |
|---|---|---|
| **Process RAM (RSS)** | **~78 MB** | Total Node.js Resident Set Size in idle state |
| **Heap Memory Used** | **~12 MB** | Active V8 JavaScript engine heap memory |
| **Heap Memory Total** | **~18 MB** | Allocated V8 JavaScript heap memory |
| **SQLite Storage Size** | **~76 KB** | Initial SQLite database file size (`dev.db`) |
| **Test Suite Execution** | **1.19s** | Time to execute 8 integration tests |

### 2. High-Concurrency Stress & Load Test Metrics
Simulates **1,500 database mutations & card operations** (creating 500 cards, updating metadata, moving across columns, adding comment feeds) in concurrent batches:

| Stress Test Metric | Value | Description |
|---|---|---|
| **Throughput / Speed** | **1,604 ops/sec** | 1,500 operations completed in **935ms** |
| **Peak RAM Usage (RSS)** | **166.52 MB** | Peak Resident Set Size memory under heavy burst load |
| **Peak Heap Memory Used** | **39.95 MB** | Peak V8 JavaScript heap during batch processing |
| **RAM Delta (Load vs Idle)** | **+88.25 MB** | Net RAM increase during 1,500 item concurrent burst |

### 🧪 How to Run Tests & Load Benchmarks Yourself

You can execute the automated tests, baseline benchmarks, or stress load tests locally at any time:

```bash
# 1. Run automated integration test suite (CRUD, JWT, Hashing)
yarn test

# 2. Profile baseline Node.js process RAM & SQLite database size
yarn benchmark

# 3. Execute high-concurrency memory load & throughput stress test (1,500 ops)
yarn load-test
```

---

## 🛠️ Prerequisites

- **Node.js**: v18.x or higher
- **Yarn**: `v1.22.x` or higher (or `npm`)

---

## 🔑 Demo Login Credentials

When database seeding is executed (`npx tsx prisma/seed.ts`), sample accounts are created:

| Account | Email | Password | Isolated Project |
|---|---|---|---|
| Admin Account | `admin@example.com` | `password123` | Open Project Manager MVP |
| Jose Account | `jose@example.com` | `password123` | Jose's Autonomous Systems |

---

## 🔌 Programmatic REST API Guide

Open Project Manager exposes a REST API under `/api/v1/` for automation and script integration.

### 1. Authenticate & Obtain JWT Token
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password123"}'
```
*Returns:* `{ "success": true, "token": "YOUR_JWT_TOKEN", ... }`

### 2. List Active Projects
```bash
curl -X GET http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Create a New Project
```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Automated Pipeline", "description": "CI/CD automated tasks", "color": "#6366f1"}'
```

### 4. Create a Task Card
```bash
curl -X POST http://localhost:3000/api/v1/cards \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PROJECT_ID",
    "columnId": "COLUMN_ID",
    "title": "Deploy v1.2 release",
    "priority": "HIGH",
    "points": 5,
    "owner": "Sarah"
  }'
```

### 5. Move a Card to Another Column
```bash
curl -X POST http://localhost:3000/api/v1/cards/CARD_ID/move \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetColumnId": "DONE_COLUMN_ID",
    "newOrder": 0
  }'
```

### 6. Query Card by Human Identifier (e.g. OPM-1)
```bash
curl -X GET http://localhost:3000/api/v1/cards/by-identifier/OPM-1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 7. Paginated Card Listing
```bash
curl -X GET "http://localhost:3000/api/v1/cards?projectId=PROJECT_ID&limit=10&cursor=CURSOR_CARD_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 8. Upload & List File Attachments
```bash
# Upload attachment via JSON base64
curl -X POST http://localhost:3000/api/v1/cards/CARD_ID/attachments \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "log.txt", "contentBase64": "SGVsbG8gV29ybGQ=", "mimeType": "text/plain"}'

# List card attachments
curl -X GET http://localhost:3000/api/v1/cards/CARD_ID/attachments \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 🤖 Model Context Protocol (MCP) Integration

Open Project Manager natively supports **Model Context Protocol (MCP)**, allowing external AI models (Claude, GPT-4, Cursor, Antigravity, custom agents) to inspect and manage workspace elements over **Stdio transport** or **REST API endpoints**.

### 1. Local Stdio Integration (Claude Desktop, Cursor, Antigravity)
Run the built-in MCP server via command line or add it to your local AI tool configuration:

```bash
yarn mcp
```

**Example `mcpServers` Configuration (Claude Desktop / Cursor / Antigravity):**
```json
{
  "mcpServers": {
    "open-project-manager": {
      "command": "npx",
      "args": ["-y", "tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/open-project-manager"
    }
  }
}
```

Stdio connections have no authenticated session, so tools that create data scoped to a user (e.g. `create_project`) require an explicit `userId` argument from the calling client — there is no fallback identity.

### 2. Remote REST API for LLM Models (`/api/v1/mcp/*`)

Remote LLMs and HTTP clients can call MCP tools over REST API endpoints:

#### List Available MCP Tools
```bash
curl -X GET http://localhost:3000/api/v1/mcp/tools
```

#### Execute an MCP Tool over REST
```bash
curl -X POST http://localhost:3000/api/v1/mcp/tools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "create_card",
    "arguments": {
      "projectId": "PROJECT_ID",
      "columnId": "COLUMN_ID",
      "title": "Build AI feature",
      "priority": "HIGH",
      "points": 5,
      "owner": "AI Agent"
    }
  }'
```

#### Read MCP Resource over REST
```bash
curl -X GET "http://localhost:3000/api/v1/mcp/resources?uri=opm://projects"
```

#### JSON-RPC 2.0 Endpoint over HTTP
```bash
curl -X POST http://localhost:3000/api/v1/mcp/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_projects",
      "arguments": { "isArchived": false }
    }
  }'
```

---

## 🐳 Docker Deployment

Open Project Manager provides an official multi-stage `Dockerfile` and `docker-compose.yml` for containerized deployments with standalone Next.js builds and SQLite data persistence.

### 1. Using Docker Compose (Recommended)

#### Option A: SQLite (Zero-Config Default)
Run the application in the background with persistent SQLite storage. `docker-compose.yml` requires a `JWT_SECRET` in a `.env` file next to it:

```bash
# Create a .env with a real secret
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env

# Build and launch container
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down
```

`docker compose up -d` first runs a one-shot `migrate` service (`prisma migrate deploy` against the
`opm_data` volume) before starting the app, so the database schema is always in sync on a fresh
deployment.

#### Option B: PostgreSQL (Opt-In)
For production setups with an integrated or centralized PostgreSQL database:

```bash
# Create a .env with a real secret
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env

# Build and launch application alongside Postgres 16
docker compose -f docker-compose.postgres.yml up -d

# View logs
docker compose -f docker-compose.postgres.yml logs -f

# Stop containers
docker compose -f docker-compose.postgres.yml down
```

The app will be accessible at [http://localhost:3000](http://localhost:3000).

### 2. Standalone Docker Build & Run
```bash
# Build Docker image
docker build -t open-project-manager .

# Apply the database schema to the volume (one-time, and after any migration)
docker build --target migrator -t open-project-manager:migrator .
docker run --rm \
  -v opm_data:/app/data \
  -e DATABASE_URL="file:/app/data/dev.db" \
  open-project-manager:migrator

# Run container with volume mount for persistent SQLite database
docker run -d \
  --name open-project-manager \
  -p 3000:3000 \
  -v opm_data:/app/data \
  -e DATABASE_URL="file:/app/data/dev.db" \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  open-project-manager
```

### Changing the schema
Schema changes go through Prisma migrations, not `db push`. After editing `prisma/schema.prisma`:

```bash
npx prisma migrate dev --name <describe-the-change>
```

Commit the generated `prisma/migrations/` folder — `migrate deploy` (run automatically by the
`migrate` service above) only applies migrations that are already committed.

---

## 🚀 Installation & Deployment Guide

Open Project Manager supports two primary production deployment methods as well as a local development workflow. For a complete, step-by-step tutorial tailored for **Raspberry Pi** (ARM64/ARMv7), home servers, and Linux VPS environments, see the dedicated [🍓 Raspberry Pi & Linux Installation Guide](docs/installation-guide.md).

### Deployment Modes at a Glance

| Mode | Best For | Persistent Storage | Process Management | Memory Footprint |
|---|---|---|---|---|
| **🐳 Docker Compose** | Isolated container setups, homelabs, easy updates | Named volume (`opm_data`) or Postgres | Docker Daemon (`restart: unless-stopped`) | ~100–120 MB |
| **⚙️ Bare-Metal / Standalone** | Minimum overhead on Raspberry Pi / Linux, maximum speed | Local `dev.db` file or Postgres | Systemd (`open-project-manager.service`) or PM2 | **~78 MB** |
| **💻 Local Development** | Hacking, contributing, extending features | Local `dev.db` file | Next.js dev server (`yarn dev`) | ~150–200 MB |

> 📖 **Full Installation Tutorial**: Follow the complete [Installation Guide (docs/installation-guide.md)](docs/installation-guide.md) for detailed swap setup, Systemd units, PM2 configs, Caddy/Nginx reverse proxy with automatic SSL, and SQLite hot backups.

---

### Quick Start (Local Development)

#### 1. Clone the Repository
```bash
git clone https://github.com/your-username/open-project-manager.git
cd open-project-manager
```

#### 2. Install Dependencies
```bash
yarn install
```

#### 3. Configure Environment Variables
Create a `.env.local` with a signing secret for auth tokens (the app refuses to start without one):
```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env.local
```

To let users sign in through an existing identity provider (Authentik, Keycloak, Authelia, etc.) alongside built-in email/password login:
```bash
OIDC_ISSUER_URL=https://idp.example.com
OIDC_CLIENT_ID=open-project-manager
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=https://opm.example.com/api/v1/auth/oidc/callback
```

#### 4. Initialize the SQLite Database
```bash
npx prisma db push
```

#### 5. Seed Sample Projects & Users (Optional)
```bash
npx tsx prisma/seed.ts
```

#### 6. Start the Development Server
```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser!

---

## 💻 Available Scripts

| Command | Description |
|---|---|
| `yarn dev` | Starts the Next.js development server on port 3000 |
| `yarn mcp` | Runs the Model Context Protocol (MCP) server on stdio |
| `yarn test` | Executes automated integration test suite |
| `yarn benchmark` | Profiles baseline Node.js process RAM and SQLite DB metrics |
| `yarn load-test` | Runs high-concurrency stress test (1,500 operations) & measures RAM spikes |
| `yarn build` | Compiles the production build |
| `yarn start` | Starts the production server |
| `npx prisma db push` | Applies schema changes to SQLite (`dev.db`) |
| `npx prisma studio` | Opens Prisma GUI to inspect and edit SQLite records visually |

---

## 📂 Project Structure

```
open-project-manager/
├── prisma/
│   ├── schema.prisma       # Prisma database models (User, Project, Column, Card, Label, Comment)
│   └── seed.ts             # Sample user accounts & project seed script
├── scripts/
│   ├── test-all.ts         # Automated integration test suite
│   ├── benchmark-memory.ts # Baseline Node process memory & DB profiler
│   └── load-test.ts        # High-concurrency stress & RAM load tester
├── src/
│   ├── actions/            # Server Actions (Auth, Projects, Columns, Cards, Labels, Comments)
│   ├── app/
│   │   ├── api/v1/         # REST API endpoints (Auth, Projects, Columns, Cards, Move)
│   │   ├── projects/[id]/  # Project Kanban, List, Analytics, & Calendar views
│   │   └── page.tsx        # Dashboard page
│   ├── components/         # React UI components (KanbanBoard, TaskCard, Modals, Views, Header)
│   ├── lib/                # Auth JWT session & SQLite connection client
│   └── middleware.ts       # Route protection & Bearer token middleware
├── prisma.config.ts        # Prisma v7 configuration
└── dev.db                  # Local SQLite database file
```

---

## 📄 License

MIT License. Free and open source for personal and commercial use.
