import crypto from "crypto";
import { db } from "@/lib/db";
import { verifyBearerToken } from "@/lib/auth";
import { createCard } from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";

export interface SlackUnfurlBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
}

export function escapeSlackMrkdwn(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getAppBaseUrl(): string {
  const url = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return url.replace(/\/$/, "");
}

export async function getLinkedOpmUser(slackUserId: string) {
  if (!slackUserId) return null;
  const record = await db.importRecord.findFirst({
    where: {
      source: "slack",
      entityType: "user",
      sourceId: slackUserId,
    },
  });
  if (!record) return null;
  return db.user.findUnique({ where: { id: record.localId } });
}

export async function linkSlackUser(slackUserId: string, opmUserId: string) {
  // Clear any existing mappings for this Slack user so one Slack account holds exactly one link
  await db.importRecord.deleteMany({
    where: {
      source: "slack",
      entityType: "user",
      sourceId: slackUserId,
    },
  });

  await db.importRecord.create({
    data: {
      userId: opmUserId,
      source: "slack",
      entityType: "user",
      sourceId: slackUserId,
      localId: opmUserId,
      importRunId: "slack-link",
    },
  });
}

export async function unlinkSlackUser(slackUserId: string) {
  await db.importRecord.deleteMany({
    where: {
      source: "slack",
      entityType: "user",
      sourceId: slackUserId,
    },
  });
}

export function verifySlackSignature(options: {
  signingSecret: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
}): boolean {
  const { signingSecret, signature, timestamp, rawBody } = options;
  if (!signingSecret || !signature || !timestamp) return false;

  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (Number.isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
    // Replay attack prevention: must be within 5 minutes
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  const mySignature = `v0=${hmac.update(sigBasestring).digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

export function formatCardUnfurl(card: {
  identifier: string;
  title: string;
  status: string;
  priority?: string | null;
  owner?: string | null;
  points?: number | null;
  url: string;
}) {
  const priority = card.priority && card.priority !== "NONE" ? card.priority : "None";
  const owner = card.owner || "Unassigned";
  const points = card.points != null ? `${card.points} pts` : "None";
  const safeTitle = escapeSlackMrkdwn(card.title);
  const safeIdentifier = escapeSlackMrkdwn(card.identifier);

  const fullUrl = card.url.startsWith("http")
    ? card.url
    : `${getAppBaseUrl()}${card.url.startsWith("/") ? "" : "/"}${card.url}`;

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${fullUrl}|${safeIdentifier}: ${safeTitle}>*`,
        },
        fields: [
          { type: "mrkdwn", text: `*Status:*\n${escapeSlackMrkdwn(card.status)}` },
          { type: "mrkdwn", text: `*Priority:*\n${priority}` },
          { type: "mrkdwn", text: `*Assignee:*\n${escapeSlackMrkdwn(owner)}` },
          { type: "mrkdwn", text: `*Points:*\n${points}` },
        ],
      },
    ],
  };
}

export function formatEventNotification(
  event: string,
  projectName: string,
  payload: {
    cardIdentifier?: string;
    cardTitle?: string;
    actorName?: string;
    toValue?: string | null;
    fromValue?: string | null;
  }
) {
  const actor = escapeSlackMrkdwn(payload.actorName || "A team member");
  const safeProject = escapeSlackMrkdwn(projectName);
  const safeId = escapeSlackMrkdwn(payload.cardIdentifier || "");
  const safeTitle = escapeSlackMrkdwn(payload.cardTitle || "");
  const safeTo = escapeSlackMrkdwn(payload.toValue || "");
  let message = "";

  switch (event) {
    case "card_created":
      message = `*${actor}* created card *${safeId}* in *${safeProject}*: "${safeTo || safeTitle}"`;
      break;
    case "moved":
      message = `*${actor}* moved *${safeId || "card"}* to *${safeTo || "a new column"}*`;
      break;
    case "comment_added":
      message = `*${actor}* commented on *${safeId || "card"}*`;
      break;
    case "priority_changed":
      message = `*${actor}* changed priority of *${safeId || "card"}* to *${safeTo || "NONE"}*`;
      break;
    default:
      message = `*${actor}* triggered event \`${event}\` on *${safeId || safeProject}*`;
  }

  return {
    text: message,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message,
        },
      },
    ],
  };
}

export async function handleSlackSlashCommand(params: {
  command: string;
  text: string;
  user_name?: string;
  user_id?: string;
  channel_id?: string;
}): Promise<{ response_type: "in_channel" | "ephemeral"; text: string; blocks?: unknown[] }> {
  const text = (params.text || "").trim();

  if (!text || text === "help") {
    return {
      response_type: "ephemeral",
      text: "Open Project Manager Slack Commands:\n" +
        "• `/opm help` - Show this help message\n" +
        "• `/opm link <api-token>` - Link your Slack account to Open Project Manager using an API token\n" +
        "• `/opm whoami` - Check your linked Open Project Manager account\n" +
        "• `/opm unlink` - Unlink your Slack account\n" +
        "• `/opm new <title>` - Create a card in your default/first project\n" +
        "• `/opm create <KEY> <title>` - Create a card in a specific project key\n" +
        "• `/opm get <KEY-123>` - Look up a card by its identifier (ephemeral)\n",
    };
  }

  const parts = text.split(/\s+/);
  const subCommand = parts[0]?.toLowerCase();

  if (subCommand === "link") {
    const token = parts[1];
    if (!token) {
      return {
        response_type: "ephemeral",
        text: "Usage: `/opm link <api-token>` (create an API token in your OPM User Profile).",
      };
    }

    if (!params.user_id) {
      return { response_type: "ephemeral", text: "Missing Slack user ID." };
    }

    const session = await verifyBearerToken(token);
    if (!session) {
      return {
        response_type: "ephemeral",
        text: "Invalid or expired API token. Please generate a new API token in your User Profile modal in Open Project Manager.",
      };
    }

    const targetUser = await db.user.findUnique({
      where: { id: session.userId },
    });

    if (!targetUser) {
      return {
        response_type: "ephemeral",
        text: "User account associated with this token could not be found.",
      };
    }

    await linkSlackUser(params.user_id, targetUser.id);
    return {
      response_type: "ephemeral",
      text: `Successfully linked your Slack account to Open Project Manager as *${escapeSlackMrkdwn(targetUser.name)}* (${targetUser.email}).`,
    };
  }

  if (subCommand === "whoami") {
    if (!params.user_id) {
      return { response_type: "ephemeral", text: "Missing Slack user ID." };
    }
    const opmUser = await getLinkedOpmUser(params.user_id);
    if (!opmUser) {
      return {
        response_type: "ephemeral",
        text: "Your Slack account is not linked to Open Project Manager. Link it with `/opm link <api-token>`.",
      };
    }
    return {
      response_type: "ephemeral",
      text: `You are linked as *${escapeSlackMrkdwn(opmUser.name)}* (${opmUser.email}) in Open Project Manager.`,
    };
  }

  if (subCommand === "unlink") {
    if (!params.user_id) {
      return { response_type: "ephemeral", text: "Missing Slack user ID." };
    }
    await unlinkSlackUser(params.user_id);
    return {
      response_type: "ephemeral",
      text: "Successfully unlinked your Slack account from Open Project Manager.",
    };
  }

  // All subsequent actions require a linked OPM user
  if (!params.user_id) {
    return {
      response_type: "ephemeral",
      text: "Missing Slack user ID.",
    };
  }

  const opmUser = await getLinkedOpmUser(params.user_id);
  if (!opmUser) {
    return {
      response_type: "ephemeral",
      text: "Your Slack account is not linked to Open Project Manager. Please link your account first by running `/opm link <api-token>`.",
    };
  }

  if (subCommand === "get") {
    if (!parts[1]) {
      return {
        response_type: "ephemeral",
        text: "Usage: `/opm get <KEY-123>`. Example: `/opm get ENG-5`",
      };
    }

    const identifier = parts[1].toUpperCase();
    const [projectKey, numStr] = identifier.split("-");
    const number = parseInt(numStr, 10);

    if (!projectKey || Number.isNaN(number)) {
      return {
        response_type: "ephemeral",
        text: `Invalid card identifier format "${parts[1]}". Expected format like "PROJ-12".`,
      };
    }

    // Scoped to projects accessible to the user
    const matchingCards = await db.card.findMany({
      where: {
        number,
        project: {
          key: projectKey,
          isArchived: false,
          OR: [
            { userId: opmUser.id },
            { members: { some: { userId: opmUser.id } } },
          ],
        },
      },
      include: {
        project: true,
        column: true,
      },
    });

    const card = matchingCards.find((c) => c.project.userId === opmUser.id) || (matchingCards.length === 1 ? matchingCards[0] : null);
    if (!card) {
      if (matchingCards.length > 1) {
        return {
          response_type: "ephemeral",
          text: `Multiple active projects match key "${projectKey}". Please contact support to disambiguate.`,
        };
      }
      return {
        response_type: "ephemeral",
        text: `Card ${identifier} was not found or you do not have permission to view it.`,
      };
    }

    const canView = await verifyProjectAccess(card.projectId, opmUser.id, "VIEWER");
    if (!canView) {
      return {
        response_type: "ephemeral",
        text: `Card ${identifier} was not found or you do not have permission to view it.`,
      };
    }

    const unfurl = formatCardUnfurl({
      identifier,
      title: card.title,
      status: card.column.name,
      priority: card.priority,
      owner: card.owner,
      points: card.points,
      url: `/projects/${card.projectId}`,
    });

    // Returned ephemerally to prevent leaking private card data into the channel
    return {
      response_type: "ephemeral",
      text: `${identifier}: ${escapeSlackMrkdwn(card.title)}`,
      blocks: unfurl.blocks,
    };
  }

  if (subCommand === "create") {
    if (parts.length < 3) {
      return {
        response_type: "ephemeral",
        text: "Usage: `/opm create <KEY> <title>`. Example: `/opm create ENG Fix navigation bar`",
      };
    }

    const projectKey = parts[1].toUpperCase();
    const title = parts.slice(2).join(" ").trim();
    if (!title) {
      return {
        response_type: "ephemeral",
        text: "Please provide a title for the card. Example: `/opm create ENG Fix navigation bar`",
      };
    }

    const candidates = await db.project.findMany({
      where: {
        key: projectKey,
        isArchived: false,
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id, role: { in: ["OWNER", "MEMBER"] } } } },
        ],
      },
      include: { columns: { orderBy: { order: "asc" } } },
    });

    const project = candidates.find((p) => p.userId === opmUser.id) || (candidates.length === 1 ? candidates[0] : null);
    if (!project) {
      if (candidates.length > 1) {
        return {
          response_type: "ephemeral",
          text: `Multiple projects match key "${projectKey}". Please specify a unique project.`,
        };
      }
      return {
        response_type: "ephemeral",
        text: `Project with key "${projectKey}" not found or you do not have permission to create cards in it.`,
      };
    }

    if (project.columns.length === 0) {
      return {
        response_type: "ephemeral",
        text: `Project "${project.name}" has no columns to place the card in.`,
      };
    }

    const targetColumn =
      project.columns.find((c: any) => c.group === "BACKLOG") ||
      project.columns.find((c: any) => c.group === "UNSTARTED") ||
      project.columns.find((c: any) => !c.isDone) ||
      project.columns[0];

    const result = await createCard(
      {
        projectId: project.id,
        columnId: targetColumn.id,
        title,
        owner: opmUser.name || opmUser.email,
      },
      opmUser.id
    );

    if (!result.success || !result.data) {
      return {
        response_type: "ephemeral",
        text: `Failed to create card: ${result.error || "Unknown error"}`,
      };
    }

    const createdCard = result.data;
    const identifier = `${project.key}-${createdCard.number}`;
    const safeTitle = escapeSlackMrkdwn(title);
    const safeProjectName = escapeSlackMrkdwn(project.name);

    return {
      response_type: "in_channel",
      text: `Created card *${identifier}* in *${safeProjectName}*: "${safeTitle}"`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Created card *${identifier}* in *${safeProjectName}* (${escapeSlackMrkdwn(targetColumn.name)})\n*${safeTitle}*`,
          },
        },
      ],
    };
  }

  if (subCommand === "new") {
    const title = parts.slice(1).join(" ").trim();
    if (!title) {
      return {
        response_type: "ephemeral",
        text: "Please provide a title for the card. Example: `/opm new Fix login bug`",
      };
    }

    const project = await db.project.findFirst({
      where: {
        isArchived: false,
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id, role: { in: ["OWNER", "MEMBER"] } } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { columns: { orderBy: { order: "asc" } } },
    });

    if (!project) {
      return {
        response_type: "ephemeral",
        text: "You do not have access to any active writable projects in Open Project Manager.",
      };
    }

    if (project.columns.length === 0) {
      return {
        response_type: "ephemeral",
        text: `Project "${project.name}" has no columns to place the card in.`,
      };
    }

    const targetColumn =
      project.columns.find((c: any) => c.group === "BACKLOG") ||
      project.columns.find((c: any) => c.group === "UNSTARTED") ||
      project.columns.find((c: any) => !c.isDone) ||
      project.columns[0];

    const result = await createCard(
      {
        projectId: project.id,
        columnId: targetColumn.id,
        title,
        owner: opmUser.name || opmUser.email,
      },
      opmUser.id
    );

    if (!result.success || !result.data) {
      return {
        response_type: "ephemeral",
        text: `Failed to create card: ${result.error || "Unknown error"}`,
      };
    }

    const createdCard = result.data;
    const identifier = `${project.key}-${createdCard.number}`;
    const safeTitle = escapeSlackMrkdwn(title);
    const safeProjectName = escapeSlackMrkdwn(project.name);

    return {
      response_type: "in_channel",
      text: `Created card *${identifier}* in *${safeProjectName}*: "${safeTitle}"`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Created card *${identifier}* in *${safeProjectName}* (${escapeSlackMrkdwn(targetColumn.name)})\n*${safeTitle}*`,
          },
        },
      ],
    };
  }

  return {
    response_type: "ephemeral",
    text: `Unknown command "${subCommand}". Type \`/opm help\` for available commands.`,
  };
}
