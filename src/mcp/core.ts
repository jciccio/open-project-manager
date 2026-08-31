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
import { DEFAULT_CARD_TYPES } from "@/lib/cardTypeDefaults";

const DEFAULT_LIST_CARDS_LIMIT = 100;

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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      destructiveHint: true,
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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "list_cards",
    description: "Query and filter task cards by project, column, priority, assignee owner, or a free-text search across title/description.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter by project ID" },
        columnId: { type: "string", description: "Filter by column ID" },
        priority: { type: "string", description: "Filter by priority (NONE, LOW, MEDIUM, HIGH, URGENT)" },
        owner: { type: "string", description: "Filter by assignee owner name" },
        assignedTo: { type: "string", description: "Filter by assigned user ID" },
        query: { type: "string", description: "Free-text search across card title and description (case-insensitive substring match)" },
        parentId: { type: "string", description: "Filter by parent card ID" },
        typeId: { type: "string", description: "Filter by card type ID" },
        isArchived: { type: "boolean", description: "Filter by archived status (default: false)" },
        limit: { type: "number", description: "Maximum number of cards to return (1-100, default 100)" },
        cursor: { type: "string", description: "Cursor card ID for pagination (returns items after this card ID)" },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "get_card",
    description: "Retrieve complete details for a specific task card including comments, labels, assignees, parent, and child cards.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task card ID" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
        parentId: { type: "string", description: "Optional parent card ID" },
        assigneeIds: { type: "array", items: { type: "string" }, description: "Optional list of assigned user IDs" },
        typeId: { type: "string", description: "Optional card type ID" },
      },
      required: ["projectId", "columnId", "title"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "update_card",
    description: "Update task card fields (title, description, priority, story points, owner, due date, columnId, parentId, assigneeIds, typeId).",
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
        parentId: { type: "string", description: "Updated parent card ID or empty string to detach" },
        assigneeIds: { type: "array", items: { type: "string" }, description: "Optional list of assigned user IDs" },
        typeId: { type: "string", description: "Updated card type ID or empty string to clear" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "reorder_cards",
    description: "Reorder multiple task cards in bulk atomically.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "List of items containing card ID, order, and optional columnId",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Card ID" },
              order: { type: "number", description: "New order position value" },
              columnId: { type: "string", description: "Optional target column ID" },
            },
            required: ["id", "order"],
          },
        },
      },
      required: ["items"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "archive_card",
    description: "Archive a task card so it is hidden from active project board views.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card ID to archive" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "unarchive_card",
    description: "Unarchive a task card so it is restored to active project board views.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card ID to unarchive" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "add_card_relation",
    description: "Add a dependency or relationship between two cards (BLOCKS, BLOCKED_BY, RELATES_TO).",
    inputSchema: {
      type: "object",
      properties: {
        sourceCardId: { type: "string", description: "Source card ID" },
        targetCardId: { type: "string", description: "Target card ID" },
        type: { type: "string", description: "Relation type: BLOCKS, BLOCKED_BY, or RELATES_TO" },
      },
      required: ["sourceCardId", "targetCardId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "remove_card_relation",
    description: "Delete an existing card relation by ID.",
    inputSchema: {
      type: "object",
      properties: {
        relationId: { type: "string", description: "CardRelation ID to remove" },
      },
      required: ["relationId"],
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "get_card_relations",
    description: "List all relations (blocking, blocked by, relates to) for a specific card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Card ID to query relations for" },
      },
      required: ["cardId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "list_card_activity",
    description: "List the audit trail / activity log of events for a specific task card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target card ID" },
      },
      required: ["cardId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "update_comment",
    description: "Update the text content of an existing comment.",
    inputSchema: {
      type: "object",
      properties: {
        commentId: { type: "string", description: "Target comment ID" },
        content: { type: "string", description: "New comment body text" },
      },
      required: ["commentId", "content"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "list_labels",
    description: "List custom labels available in the workspace or specific project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Optional project ID scope" },
        userId: { type: "string", description: "Optional user ID scope" },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
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
        projectId: { type: "string", description: "Optional project ID scope" },
        userId: { type: "string", description: "Optional user ID scope" },
      },
      required: ["name"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "list_card_types",
    description: "List the custom card/work-item types configured for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["projectId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "create_card_type",
    description: "Create a new custom card/work-item type for a project (e.g. Bug, Feature, Chore).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID" },
        name: { type: "string", description: "Type name" },
        icon: { type: "string", description: "Icon identifier (default: Tag)" },
        color: { type: "string", description: "Color hex code (default: #6366f1)" },
      },
      required: ["projectId", "name"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "update_card_type",
    description: "Update a card type's name, icon, or color.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card type ID" },
        name: { type: "string", description: "Updated type name" },
        icon: { type: "string", description: "Updated icon identifier" },
        color: { type: "string", description: "Updated color hex code" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "delete_card_type",
    description: "Delete a card type. Cards using it keep their other fields but revert to no type.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card type ID to delete" },
      },
      required: ["id"],
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "add_attachment",
    description: "Upload a file attachment to a task card using a base64-encoded string.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target task card ID" },
        filename: { type: "string", description: "Original filename" },
        contentBase64: { type: "string", description: "Base64-encoded file contents" },
        mimeType: { type: "string", description: "Optional MIME type (e.g. image/png, text/plain)" },
        uploadedBy: { type: "string", description: "Optional uploader identifier" },
        userId: { type: "string", description: "Optional user ID scope" },
      },
      required: ["cardId", "filename", "contentBase64"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "list_attachments",
    description: "List all file attachments associated with a specific task card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target task card ID" },
      },
      required: ["cardId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "delete_attachment",
    description: "Delete a task card attachment permanently by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Attachment ID to delete" },
        userId: { type: "string", description: "Optional user ID scope" },
      },
      required: ["id"],
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "add_card_link",
    description: "Add an external link (URL) to a task card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "Target task card ID" },
        url: { type: "string", description: "URL to attach" },
        title: { type: "string", description: "Optional title for the link" },
      },
      required: ["cardId", "url"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "remove_card_link",
    description: "Delete an external link from a task card by its link ID.",
    inputSchema: {
      type: "object",
      properties: {
        linkId: { type: "string", description: "Link ID to remove" },
      },
      required: ["linkId"],
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: "list_saved_views",
    description: "List all saved filter views configured for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project ID" },
      },
      required: ["projectId"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "create_saved_view",
    description: "Create a named saved view with a JSON filter configuration for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID to attach the view to" },
        name: { type: "string", description: "Display name of the saved view" },
        filterJson: { type: "string", description: "JSON string or object of filter parameters" },
        isDefault: { type: "boolean", description: "Whether this view should be the default" },
      },
      required: ["projectId", "name"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "update_saved_view",
    description: "Update an existing saved view's name, filter configuration, or default status.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Saved view ID to update" },
        name: { type: "string", description: "New display name" },
        filterJson: { type: "string", description: "New JSON filter configuration" },
        isDefault: { type: "boolean", description: "Set as default view" },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: "delete_saved_view",
    description: "Delete a saved view permanently by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Saved view ID to delete" },
      },
      required: ["id"],
    },
    annotations: {
      destructiveHint: true,
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
          cardTypes: {
            create: DEFAULT_CARD_TYPES,
          },
        },
        include: { columns: true, cardTypes: true },
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
      const where: any = {
        isArchived: typeof args.isArchived === "boolean" ? args.isArchived : false,
      };
      if (args.projectId) where.projectId = args.projectId;
      if (args.columnId) where.columnId = args.columnId;
      if (args.priority) where.priority = args.priority;
      if (args.owner) where.owner = { contains: args.owner };
      if (args.assignedTo) where.assignees = { some: { userId: args.assignedTo } };
      if (args.query) {
        where.OR = [
          { title: { contains: args.query } },
          { description: { contains: args.query } },
        ];
      }

      if (args.parentId !== undefined) {
        where.parentId = args.parentId || null;
      }
      if (args.typeId) where.typeId = args.typeId;

      let limit: number = DEFAULT_LIST_CARDS_LIMIT;
      if (typeof args.limit === "number") {
        limit = Math.min(Math.max(1, Math.floor(args.limit)), 100);
      } else if (args.limit) {
        const parsed = parseInt(String(args.limit), 10);
        if (!isNaN(parsed)) {
          limit = Math.min(Math.max(1, parsed), 100);
        }
      }

      const queryOptions: any = {
        where,
        orderBy: [{ order: "asc" }, { id: "asc" }],
        include: {
          column: { select: { name: true } },
          type: true,
          labels: { include: { label: true } },
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          parent: { select: { id: true, number: true, title: true } },
          children: { select: { id: true, number: true, title: true, completedAt: true } },
          _count: { select: { comments: true } },
        },
        take: limit,
      };

      if (args.cursor) {
        queryOptions.cursor = { id: args.cursor };
        queryOptions.skip = 1;
      }

      const cards = await db.card.findMany(queryOptions);
      const nextCursor = cards.length === limit ? cards[cards.length - 1].id : null;
      return { success: true, cards, nextCursor };
    }

    case "get_card": {
      const card = await db.card.findUnique({
        where: { id: args.id },
        include: {
          column: true,
          project: true,
          type: true,
          labels: { include: { label: true } },
          comments: { orderBy: { createdAt: "desc" } },
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          parent: { select: { id: true, number: true, title: true } },
          children: { select: { id: true, number: true, title: true, completedAt: true } },
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
          type: true,
          labels: { include: { label: true } },
          comments: { orderBy: { createdAt: "desc" } },
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          parent: { select: { id: true, number: true, title: true } },
          children: { select: { id: true, number: true, title: true, completedAt: true } },
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
      const ORDER_GAP = 10000;
      let order = ORDER_GAP;
      const lastCard = await db.card.findFirst({
        where: { columnId: args.columnId },
        orderBy: { order: "desc" },
      });
      if (lastCard) order = lastCard.order + ORDER_GAP;

      const maxCard = await db.card.findFirst({
        where: { projectId: args.projectId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const nextNumber = maxCard ? maxCard.number + 1 : 1;

      const targetCol = await db.column.findUnique({ where: { id: args.columnId } });
      const completedAt = targetCol?.isDone ? new Date() : null;

      const card = await db.card.create({
        data: {
          projectId: args.projectId,
          columnId: args.columnId,
          title: args.title.trim(),
          description: args.description || null,
          number: nextNumber,
          priority: args.priority || "NONE",
          points: typeof args.points === "number" ? args.points : null,
          owner: args.owner || null,
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          completedAt,
          order,
          parentId: args.parentId || null,
          typeId: args.typeId || null,
          assignees:
            args.assigneeIds && args.assigneeIds.length > 0
              ? {
                  create: args.assigneeIds.map((userId: string) => ({ userId })),
                }
              : undefined,
        },
        include: {
          type: true,
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          parent: { select: { id: true, number: true, title: true } },
          children: { select: { id: true, number: true, title: true, completedAt: true } },
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
      if (args.columnId !== undefined) {
        data.columnId = args.columnId;
        const targetCol = await db.column.findUnique({ where: { id: args.columnId } });
        data.completedAt = targetCol?.isDone ? new Date() : null;
      }
      if (args.dueDate !== undefined) {
        data.dueDate = args.dueDate ? new Date(args.dueDate) : null;
      }
      if (args.parentId !== undefined) {
        data.parentId = args.parentId || null;
      }
      if (args.typeId !== undefined) {
        data.typeId = args.typeId || null;
      }

      if (args.assigneeIds !== undefined) {
        await db.cardAssignee.deleteMany({ where: { cardId: args.id } });
        if (args.assigneeIds.length > 0) {
          data.assignees = {
            create: args.assigneeIds.map((userId: string) => ({ userId })),
          };
        }
      }

      const card = await db.card.update({
        where: { id: args.id },
        data,
        include: {
          type: true,
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          parent: { select: { id: true, number: true, title: true } },
          children: { select: { id: true, number: true, title: true, completedAt: true } },
        },
      });
      return { success: true, card };
    }

    case "move_card": {
      const targetColumnId = args.targetColumnId;
      const newOrder = typeof args.newOrder === "number" ? args.newOrder : 0;
      const targetCol = await db.column.findUnique({ where: { id: targetColumnId } });
      const completedAt = targetCol?.isDone ? new Date() : null;

      const card = await db.card.update({
        where: { id: args.id },
        data: {
          columnId: targetColumnId,
          order: newOrder,
          completedAt,
        },
      });
      return { success: true, card };
    }

    case "reorder_cards": {
      const items = args.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: "items array is required" };
      }
      const updates = items.map((item: any) =>
        db.card.update({
          where: { id: item.id },
          data: {
            order: item.order,
            ...(item.columnId ? { columnId: item.columnId } : {}),
          },
        })
      );
      await db.$transaction(updates);
      return { success: true, count: items.length };
    }

    case "delete_card": {
      await db.card.delete({ where: { id: args.id } });
      return { success: true, deletedId: args.id };
    }

    case "archive_card": {
      const card = await db.card.update({
        where: { id: args.id },
        data: { isArchived: true },
      });
      return { success: true, card };
    }

    case "unarchive_card": {
      const card = await db.card.update({
        where: { id: args.id },
        data: { isArchived: false },
      });
      return { success: true, card };
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

    case "list_card_activity": {
      const activities = await db.activity.findMany({
        where: { cardId: args.cardId },
        orderBy: { createdAt: "desc" },
      });
      return { success: true, activities };
    }

    case "update_comment": {
      const comment = await db.comment.update({
        where: { id: args.commentId },
        data: { content: args.content.trim() },
      });
      return { success: true, comment };
    }

    case "add_card_relation": {
      const type = args.type ? args.type.toUpperCase().trim() : "BLOCKS";
      const relation = await db.cardRelation.create({
        data: {
          sourceCardId: args.sourceCardId,
          targetCardId: args.targetCardId,
          type,
        },
      });
      return { success: true, relation };
    }

    case "remove_card_relation": {
      await db.cardRelation.delete({ where: { id: args.relationId } });
      return { success: true, deletedId: args.relationId };
    }

    case "get_card_relations": {
      const outgoing = await db.cardRelation.findMany({
        where: { sourceCardId: args.cardId },
        include: { targetCard: { include: { project: true, column: true } } },
      });
      const incoming = await db.cardRelation.findMany({
        where: { targetCardId: args.cardId },
        include: { sourceCard: { include: { project: true, column: true } } },
      });

      const relations = [
        ...outgoing.map((r) => ({
          id: r.id,
          relationType: r.type,
          cardId: r.targetCardId,
          cardTitle: r.targetCard.title,
          identifier: `${r.targetCard.project.key}-${r.targetCard.number}`,
          columnName: r.targetCard.column.name,
          isDone: r.targetCard.column.isDone,
          direction: "outgoing",
        })),
        ...incoming.map((r) => ({
          id: r.id,
          relationType: r.type === "BLOCKS" ? "BLOCKED_BY" : r.type === "BLOCKED_BY" ? "BLOCKS" : r.type,
          cardId: r.sourceCardId,
          cardTitle: r.sourceCard.title,
          identifier: `${r.sourceCard.project.key}-${r.sourceCard.number}`,
          columnName: r.sourceCard.column.name,
          isDone: r.sourceCard.column.isDone,
          direction: "incoming",
        })),
      ];

      return { success: true, relations };
    }

    case "list_labels": {
      const where: any = {};
      if (args.projectId) where.OR = [{ projectId: args.projectId }, { userId: null, projectId: null }];
      else if (args.userId) where.userId = args.userId;

      const labels = await db.label.findMany({
        where,
        orderBy: { name: "asc" },
      });
      return { success: true, labels };
    }

    case "create_label": {
      const label = await db.label.create({
        data: {
          name: args.name.trim(),
          color: args.color || "#3b82f6",
          projectId: args.projectId || null,
          userId: args.projectId ? null : (args.userId || null),
        },
      });
      return { success: true, label };
    }

    case "list_card_types": {
      const cardTypes = await db.cardType.findMany({
        where: { projectId: args.projectId },
        orderBy: { name: "asc" },
      });
      return { success: true, cardTypes };
    }

    case "create_card_type": {
      const cardType = await db.cardType.create({
        data: {
          projectId: args.projectId,
          name: args.name.trim(),
          icon: args.icon || "Tag",
          color: args.color || "#6366f1",
        },
      });
      return { success: true, cardType };
    }

    case "update_card_type": {
      const data: any = {};
      if (args.name !== undefined) data.name = args.name.trim();
      if (args.icon !== undefined) data.icon = args.icon;
      if (args.color !== undefined) data.color = args.color;

      const cardType = await db.cardType.update({
        where: { id: args.id },
        data,
      });
      return { success: true, cardType };
    }

    case "delete_card_type": {
      await db.cardType.delete({ where: { id: args.id } });
      return { success: true };
    }

    case "add_attachment": {
      const buffer = Buffer.from(args.contentBase64, "base64");
      const { uploadAttachment } = await import("@/lib/services/attachments");
      const res = await uploadAttachment(
        {
          cardId: args.cardId,
          filename: args.filename,
          contentBuffer: buffer,
          mimeType: args.mimeType,
          uploadedBy: args.uploadedBy,
        },
        requireUserId(args.userId)
      );
      if (!res.success) {
        throw new Error(res.error || "Failed to upload attachment");
      }
      return { success: true, attachment: res.data };
    }

    case "list_attachments": {
      const attachments = await db.attachment.findMany({
        where: { cardId: args.cardId },
        orderBy: { createdAt: "desc" },
      });
      return { success: true, attachments };
    }

    case "delete_attachment": {
      const { deleteAttachment } = await import("@/lib/services/attachments");
      const res = await deleteAttachment(args.id, requireUserId(args.userId));
      if (!res.success) {
        throw new Error(res.error || "Failed to delete attachment");
      }
      return { success: true, deletedId: args.id };
    }

    case "add_card_link": {
      const link = await db.cardLink.create({
        data: {
          cardId: args.cardId,
          url: args.url,
          title: args.title || null,
        },
      });
      return { success: true, link };
    }

    case "remove_card_link": {
      await db.cardLink.delete({ where: { id: args.linkId } });
      return { success: true, deletedId: args.linkId };
    }

    case "list_saved_views": {
      const savedViews = await db.savedView.findMany({
        where: { projectId: args.projectId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      return { success: true, savedViews };
    }

    case "create_saved_view": {
      const filterJson =
        typeof args.filterJson === "object" ? JSON.stringify(args.filterJson) : args.filterJson;

      if (args.isDefault) {
        await db.savedView.updateMany({
          where: { projectId: args.projectId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const savedView = await db.savedView.create({
        data: {
          projectId: args.projectId,
          name: args.name.trim(),
          filterJson: filterJson || "{}",
          isDefault: !!args.isDefault,
        },
      });
      return { success: true, savedView };
    }

    case "update_saved_view": {
      const data: any = {};
      if (args.name !== undefined) data.name = args.name.trim();
      if (args.filterJson !== undefined) {
        data.filterJson =
          typeof args.filterJson === "object" ? JSON.stringify(args.filterJson) : args.filterJson;
      }
      if (args.isDefault !== undefined) {
        data.isDefault = args.isDefault;
        if (args.isDefault) {
          const existing = await db.savedView.findUnique({ where: { id: args.id } });
          if (existing) {
            await db.savedView.updateMany({
              where: { projectId: existing.projectId, isDefault: true, id: { not: args.id } },
              data: { isDefault: false },
            });
          }
        }
      }

      const savedView = await db.savedView.update({
        where: { id: args.id },
        data,
      });
      return { success: true, savedView };
    }

    case "delete_saved_view": {
      await db.savedView.delete({ where: { id: args.id } });
      return { success: true, deletedId: args.id };
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
