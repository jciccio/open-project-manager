import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "@/lib/db";

function requireUserId(providedUserId?: string): string {
  if (providedUserId) return providedUserId;
  throw new Error(
    "userId is required — MCP tool calls must include an authenticated userId."
  );
}

export const MCP_TOOLS = [
  {
    name: "list_projects",
    description: "List all projects in the workspace, optionally filtering by archived status.",
    inputSchema: {
      type: "object",
      properties: {
        isArchived: {
          type: "boolean",
          description: "Whether to list archived projects (default: false)",
        },
        userId: {
          type: "string",
          description: "Optional User ID to scope projects",
        },
      },
    },
  },
  {
    name: "get_project",
    description: "Retrieve full details for a specific project, including columns, task cards, labels, and comments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the project" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_project",
    description: "Create a new project with default Kanban columns (Backlog, To Do, In Progress, Done).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the project" },
        description: { type: "string", description: "Optional project description" },
        color: { type: "string", description: "Hex color code (e.g. #6366f1)" },
        userId: { type: "string", description: "Owner user ID (defaults to active session/admin)" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Update project metadata or archive/unarchive status.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID to update" },
        name: { type: "string", description: "New project name" },
        description: { type: "string", description: "New project description" },
        color: { type: "string", description: "New color hex code" },
        isArchived: { type: "boolean", description: "Archive or unarchive state" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_project",
    description: "Permanently delete a project and all associated columns, cards, and comments.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Project ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_columns",
    description: "List columns for a given project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_column",
    description: "Add a new column to a project board.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project ID" },
        name: { type: "string", description: "Column name" },
        order: { type: "number", description: "Optional column order position index" },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "update_column",
    description: "Update column title or position order.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Column ID" },
        name: { type: "string", description: "New column name" },
        order: { type: "number", description: "New order position index" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_column",
    description: "Delete a column from a project.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Column ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_cards",
    description: "Query and filter task cards by project, column, priority, or assignee owner.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter by project ID" },
        columnId: { type: "string", description: "Filter by column ID" },
        priority: { type: "string", description: "Filter by priority (LOW, MEDIUM, HIGH, URGENT)" },
        owner: { type: "string", description: "Filter by assignee owner name" },
      },
    },
  },
  {
    name: "get_card",
    description: "Retrieve complete details for a specific task card including comments and labels.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task card ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_card_by_identifier",
    description: "Retrieve complete task card details using human-readable identifier (e.g. OPM-42 or PROJ-1).",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Human-readable identifier like OPM-42" },
      },
      required: ["identifier"],
    },
  },
  {
    name: "create_card",
    description: "Create a new task card in a project column.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        columnId: { type: "string", description: "Target column ID" },
        title: { type: "string", description: "Card title" },
        description: { type: "string", description: "Detailed description of the task" },
        priority: { type: "string", description: "Priority level: LOW, MEDIUM, HIGH, URGENT (default: MEDIUM)" },
        points: { type: "number", description: "Story points estimation" },
        owner: { type: "string", description: "Assignee or owner name" },
        dueDate: { type: "string", description: "ISO date string for deadline (e.g. 2026-09-01)" },
      },
      required: ["projectId", "columnId", "title"],
    },
  },
  {
    name: "update_card",
    description: "Update task card fields (title, description, priority, story points, owner, due date, columnId).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card ID to update" },
        title: { type: "string", description: "Updated card title" },
        description: { type: "string", description: "Updated card description" },
        priority: { type: "string", description: "Updated priority (LOW, MEDIUM, HIGH, URGENT)" },
        points: { type: "number", description: "Updated story points" },
        owner: { type: "string", description: "Updated assignee owner name" },
        dueDate: { type: "string", description: "Updated ISO due date string or empty string to clear" },
        columnId: { type: "string", description: "Move to a different column ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "move_card",
    description: "Move a task card to another column or update its order position index.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card ID to move" },
        targetColumnId: { type: "string", description: "Target column ID" },
        newOrder: { type: "number", description: "New order position index (default: 0)" },
      },
      required: ["id", "targetColumnId"],
    },
  },
  {
    name: "delete_card",
    description: "Delete a task card permanently.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment feed entry to a task card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target card ID" },
        author: { type: "string", description: "Name of the author" },
        content: { type: "string", description: "Comment body text" },
      },
      required: ["cardId", "author", "content"],
    },
  },
  {
    name: "list_comments",
    description: "List all comments for a specific task card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target card ID" },
      },
      required: ["cardId"],
    },
  },
  {
    name: "list_labels",
    description: "List custom labels available in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Optional user ID" },
      },
    },
  },
  {
    name: "create_label",
    description: "Create a new custom color-coded label.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Label name" },
        color: { type: "string", description: "Color hex code (default: #3b82f6)" },
        userId: { type: "string", description: "Optional user ID scope" },
      },
      required: ["name"],
    },
  },
];

export async function executeMcpTool(name: string, args: Record<string, any> = {}) {
  switch (name) {
    case "list_projects": {
      const isArchived = args.isArchived ?? false;
      const where: any = { isArchived };
      if (args.userId) where.userId = args.userId;
      const projects = await db.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { cards: true, columns: true } },
        },
      });
      return { success: true, projects };
    }

    case "get_project": {
      const project = await db.project.findUnique({
        where: { id: args.id },
        include: {
          columns: {
            orderBy: { order: "asc" },
            include: {
              cards: {
                orderBy: { order: "asc" },
                include: {
                  labels: { include: { label: true } },
                  comments: { orderBy: { createdAt: "desc" } },
                },
              },
            },
          },
        },
      });
      if (!project) throw new Error(`Project with ID ${args.id} not found.`);
      return { success: true, project };
    }

    case "create_project": {
      const userId = requireUserId(args.userId);
      const nameStr = args.name.trim();
      const words = nameStr.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter(Boolean);
      const generatedKey = words.length >= 2 ? words.map((w: string) => w[0].toUpperCase()).join("").slice(0, 6) : (nameStr.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "PROJ");
      const projectKey = args.key ? args.key.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : generatedKey;
      const project = await db.project.create({
        data: {
          userId,
          name: nameStr,
          key: projectKey,
          description: args.description || null,
          color: args.color || "#6366f1",
          columns: {
            create: [
              { name: "Backlog", order: 0 },
              { name: "To Do", order: 1 },
              { name: "In Progress", order: 2 },
              { name: "Done", order: 3 },
            ],
          },
        },
        include: { columns: true },
      });
      return { success: true, project };
    }

    case "update_project": {
      const data: any = {};
      if (args.name !== undefined) data.name = args.name.trim();
      if (args.description !== undefined) data.description = args.description;
      if (args.color !== undefined) data.color = args.color;
      if (args.isArchived !== undefined) data.isArchived = args.isArchived;

      const project = await db.project.update({
        where: { id: args.id },
        data,
      });
      return { success: true, project };
    }

    case "delete_project": {
      await db.project.delete({ where: { id: args.id } });
      return { success: true, deletedId: args.id };
    }

    case "list_columns": {
      const columns = await db.column.findMany({
        where: { projectId: args.projectId },
        orderBy: { order: "asc" },
        include: { _count: { select: { cards: true } } },
      });
      return { success: true, columns };
    }

    case "create_column": {
      let order = args.order;
      if (order === undefined) {
        const lastCol = await db.column.findFirst({
          where: { projectId: args.projectId },
          orderBy: { order: "desc" },
        });
        order = lastCol ? lastCol.order + 1 : 0;
      }
      const column = await db.column.create({
        data: {
          projectId: args.projectId,
          name: args.name.trim(),
          order,
        },
      });
      return { success: true, column };
    }

    case "update_column": {
      const data: any = {};
      if (args.name !== undefined) data.name = args.name.trim();
      if (args.order !== undefined) data.order = args.order;

      const column = await db.column.update({
        where: { id: args.id },
        data,
      });
      return { success: true, column };
    }

    case "delete_column": {
      await db.column.delete({ where: { id: args.id } });
      return { success: true, deletedId: args.id };
    }

    case "list_cards": {
      const where: any = {};
      if (args.projectId) where.projectId = args.projectId;
      if (args.columnId) where.columnId = args.columnId;
      if (args.priority) where.priority = args.priority;
      if (args.owner) where.owner = { contains: args.owner };

      const cards = await db.card.findMany({
        where,
        orderBy: { order: "asc" },
        include: {
          column: { select: { name: true } },
          labels: { include: { label: true } },
          _count: { select: { comments: true } },
        },
      });
      return { success: true, cards };
    }

    case "get_card": {
      const card = await db.card.findUnique({
        where: { id: args.id },
        include: {
          column: true,
          project: true,
          labels: { include: { label: true } },
          comments: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!card) throw new Error(`Card with ID ${args.id} not found.`);
      return {
        success: true,
        card: {
          ...card,
          identifier: `${card.project.key}-${card.number}`,
        },
      };
    }

    case "get_card_by_identifier": {
      const clean = (args.identifier || "").trim();
      const lastDash = clean.lastIndexOf("-");
      if (lastDash === -1) {
        throw new Error(`Invalid identifier format '${clean}'. Expected KEY-NUMBER (e.g. OPM-42).`);
      }
      const key = clean.slice(0, lastDash).toUpperCase();
      const num = parseInt(clean.slice(lastDash + 1), 10);
      if (isNaN(num)) {
        throw new Error(`Invalid sequence number in identifier '${clean}'.`);
      }

      const card = await db.card.findFirst({
        where: {
          number: num,
          project: { key },
        },
        include: {
          column: true,
          project: true,
          labels: { include: { label: true } },
          comments: { orderBy: { createdAt: "desc" } },
        },
      });

      if (!card) throw new Error(`Card with identifier '${clean}' not found.`);
      return {
        success: true,
        card: {
          ...card,
          identifier: `${card.project.key}-${card.number}`,
        },
      };
    }

    case "create_card": {
      let order = 0;
      const lastCard = await db.card.findFirst({
        where: { columnId: args.columnId },
        orderBy: { order: "desc" },
      });
      if (lastCard) order = lastCard.order + 1;

      const maxCard = await db.card.findFirst({
        where: { projectId: args.projectId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const nextNumber = maxCard ? maxCard.number + 1 : 1;

      const card = await db.card.create({
        data: {
          projectId: args.projectId,
          columnId: args.columnId,
          title: args.title.trim(),
          description: args.description || null,
          number: nextNumber,
          priority: args.priority || "MEDIUM",
          points: typeof args.points === "number" ? args.points : null,
          owner: args.owner || null,
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          order,
        },
      });
      return { success: true, card };
    }

    case "update_card": {
      const data: any = {};
      if (args.title !== undefined) data.title = args.title.trim();
      if (args.description !== undefined) data.description = args.description;
      if (args.priority !== undefined) data.priority = args.priority;
      if (args.points !== undefined) data.points = args.points;
      if (args.owner !== undefined) data.owner = args.owner;
      if (args.columnId !== undefined) data.columnId = args.columnId;
      if (args.dueDate !== undefined) {
        data.dueDate = args.dueDate ? new Date(args.dueDate) : null;
      }

      const card = await db.card.update({
        where: { id: args.id },
        data,
      });
      return { success: true, card };
    }

    case "move_card": {
      const targetColumnId = args.targetColumnId;
      const newOrder = typeof args.newOrder === "number" ? args.newOrder : 0;

      const card = await db.card.update({
        where: { id: args.id },
        data: {
          columnId: targetColumnId,
          order: newOrder,
        },
      });
      return { success: true, card };
    }

    case "delete_card": {
      await db.card.delete({ where: { id: args.id } });
      return { success: true, deletedId: args.id };
    }

    case "add_comment": {
      const comment = await db.comment.create({
        data: {
          cardId: args.cardId,
          author: args.author.trim(),
          content: args.content.trim(),
        },
      });
      return { success: true, comment };
    }

    case "list_comments": {
      const comments = await db.comment.findMany({
        where: { cardId: args.cardId },
        orderBy: { createdAt: "desc" },
      });
      return { success: true, comments };
    }

    case "list_labels": {
      const labels = await db.label.findMany({
        orderBy: { name: "asc" },
      });
      return { success: true, labels };
    }

    case "create_label": {
      const label = await db.label.create({
        data: {
          name: args.name.trim(),
          color: args.color || "#3b82f6",
          userId: args.userId || null,
        },
      });
      return { success: true, label };
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "open-project-manager-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Tools Handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MCP_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await executeMcpTool(name, args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing tool '${name}': ${error.message || String(error)}`,
          },
        ],
      };
    }
  });

  // Resources Handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "opm://projects",
          name: "All Workspace Projects",
          mimeType: "application/json",
          description: "List of active projects in Open Project Manager",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === "opm://projects") {
      const projects = await db.project.findMany({
        where: { isArchived: false },
        include: { _count: { select: { cards: true, columns: true } } },
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith("opm://projects/")) {
      const id = uri.replace("opm://projects/", "");
      const project = await db.project.findUnique({
        where: { id },
        include: {
          columns: {
            orderBy: { order: "asc" },
            include: { cards: true },
          },
        },
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith("opm://cards/")) {
      const id = uri.replace("opm://cards/", "");
      const card = await db.card.findUnique({
        where: { id },
        include: {
          column: true,
          comments: true,
        },
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(card, null, 2),
          },
        ],
      };
    }

    throw new Error(`Resource non-existent: ${uri}`);
  });

  // Prompts Handlers
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "summarize_project",
          description: "Generate a status report and task distribution summary for a project",
          arguments: [
            {
              name: "projectId",
              description: "Project ID to summarize",
              required: true,
            },
          ],
        },
        {
          name: "generate_task_breakdown",
          description: "Generate Kanban task card suggestions for a high-level feature",
          arguments: [
            {
              name: "featureTitle",
              description: "Title of feature to break down",
              required: true,
            },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "summarize_project") {
      const projectId = args?.projectId;
      const project = await db.project.findUnique({
        where: { id: projectId },
        include: {
          columns: {
            include: { cards: true },
          },
        },
      });
      return {
        description: `Project Summary Prompt for ${project?.name || projectId}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please analyze the current status of project '${project?.name}':\n${JSON.stringify(
                project,
                null,
                2
              )}\nProvide a bulleted sprint status report, total story points, and high priority risks.`,
            },
          },
        ],
      };
    }

    if (name === "generate_task_breakdown") {
      const featureTitle = args?.featureTitle || "New Feature";
      return {
        description: `Task Breakdown Prompt for feature: ${featureTitle}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Break down the feature '${featureTitle}' into 3 to 6 actionable Kanban cards with priority levels, estimated story points, and descriptions.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt name: ${name}`);
  });

  return server;
}
