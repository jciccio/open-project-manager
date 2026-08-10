# Open Project Manager 🚀

A lightweight, fast, and self-hosted project management web application inspired by Vikunja. Built with **Next.js 15+ (App Router)**, **TypeScript**, **Tailwind CSS**, and **SQLite + Prisma ORM (v7)**.

![Stack](https://img.shields.io/badge/Stack-Next.js%20%7C%20TypeScript%20%7C%20SQLite%20%7C%20Prisma%207-indigo)

---
<img width="1512" height="731" alt="Screenshot 2026-08-09 at 12 28 28 PM" src="https://github.com/user-attachments/assets/bbf583f6-7c34-419c-82c6-4e44a71c7361" />
<img width="1512" height="657" alt="Screenshot 2026-08-09 at 12 32 36 PM" src="https://github.com/user-attachments/assets/ea71ba27-8c15-4263-bcad-0b8c46313f5c" />

<img width="794" height="696" alt="Screenshot 2026-08-09 at 12 32 23 PM" src="https://github.com/user-attachments/assets/9c81cd08-8fe2-486b-8a17-da6df13bbc31" />
<img width="1511" height="700" alt="Screenshot 2026-08-09 at 12 35 04 PM" src="https://github.com/user-attachments/assets/33e3e52b-d7b5-4c37-8066-a3c245ee2a2d" />
<img width="1507" height="717" alt="Screenshot 2026-08-09 at 12 34 24 PM" src="https://github.com/user-attachments/assets/32dc835d-e0ee-427c-beff-f3735a12a733" />


---

## ✨ Features

- 🔒 **User Authentication & Profile Management**: Registration, login, logout, profile settings modal (display name, email, and password update), and privacy-focused header user badge.
- 🌐 **Multi-Language Support (i18n)**: Switch between English (`EN`) and Spanish (`ES`) locales with persistent preference.
- 🔌 **Programmatic REST API (`/api/v1/*`)**: Complete REST API with Bearer token support for workflow automation, script integrations, and external tools.
- 🎨 **Dark & Light Mode Switcher**: Seamless theme switcher with persistent user preference.
- 📊 **Multiple Project Views**: Switch between Kanban Board, Structured List View, Analytics & Graphs (Recharts), and Monthly Calendar View.
- 📁 **Project Archiving**: Archive completed or inactive projects to clean up your active dashboard.
- 📋 **Customizable & Reorganizable Kanban Boards**: Create custom columns and easily reorder columns left or right with instant SQLite persistence.
- 🎯 **Rich Task Card Metadata**:
  - **Story Points**: Track task estimation points.
  - **Priority Levels**: Assign Low, Medium, High, or Urgent badges.
  - **Assignees & Owners**: Assign team members to cards.
  - **Labels**: Tag cards with custom color-coded labels (e.g. Frontend, Backend, UI/UX, Bug).
  - **Due Dates**: Track deadlines per task.
- 💬 **Comment Feeds**: Discuss tasks and post comments directly on task cards.
- 🐳 **Official Docker Image & Compose**: Multi-stage `Dockerfile` standalone production build and single-command `docker-compose.yml` orchestration with volume persistence.
- 🪶 **Lightweight & Portable**: Single `.sqlite` file database stored locally (`dev.db`).

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
Run the application in the background with persistent SQLite storage:

```bash
# Build and launch container
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down
```

The app will be accessible at [http://localhost:3000](http://localhost:3000).

### 2. Standalone Docker Build & Run
```bash
# Build Docker image
docker build -t open-project-manager .

# Run container with volume mount for persistent SQLite database
docker run -d \
  --name open-project-manager \
  -p 3000:3000 \
  -v opm_data:/app/dev.db \
  -e JWT_SECRET="your-production-secret-key" \
  open-project-manager
```

---

## 🚀 Installation & Usage Guide

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/open-project-manager.git
cd open-project-manager
```

### 2. Install Dependencies
This project uses **Yarn** for dependency management:
```bash
yarn install
```

### 3. Initialize the SQLite Database
Synchronize the Prisma v7 schema with your local SQLite database:
```bash
npx prisma db push
```

### 4. Seed Sample Projects & Users (Optional)
Populate the database with sample user accounts, project boards, cards, labels, and comments:
```bash
npx tsx prisma/seed.ts
```

### 5. Start the Development Server
Run the Next.js local development server:
```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser to log in or register a new account!

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
