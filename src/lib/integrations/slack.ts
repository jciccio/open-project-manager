import crypto from "crypto";
import { db } from "@/lib/db";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";

export interface SlackUnfurlBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
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

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${card.url}|${card.identifier}: ${card.title}>*`,
        },
        fields: [
          { type: "mrkdwn", text: `*Status:*\n${card.status}` },
          { type: "mrkdwn", text: `*Priority:*\n${priority}` },
          { type: "mrkdwn", text: `*Assignee:*\n${owner}` },
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
  const actor = payload.actorName || "A team member";
  let message = "";

  switch (event) {
    case "card_created":
      message = `*${actor}* created card *${payload.cardIdentifier || ""}* in *${projectName}*: "${payload.toValue || payload.cardTitle || ""}"`;
      break;
    case "moved":
      message = `*${actor}* moved *${payload.cardIdentifier || "card"}* to *${payload.toValue || "a new column"}*`;
      break;
    case "comment_added":
      message = `*${actor}* commented on *${payload.cardIdentifier || "card"}*`;
      break;
    case "priority_changed":
      message = `*${actor}* changed priority of *${payload.cardIdentifier || "card"}* to *${payload.toValue || "NONE"}*`;
      break;
    default:
      message = `*${actor}* triggered event \`${event}\` on *${payload.cardIdentifier || projectName}*`;
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
        "• `/opm new <title>` - Create a card in your default/first project\n" +
        "• `/opm create <KEY> <title>` - Create a card in a specific project key\n" +
        "• `/opm get <KEY-123>` - Look up a card by its identifier\n",
    };
  }

  const parts = text.split(/\s+/);
  const subCommand = parts[0]?.toLowerCase();

  if (subCommand === "get" && parts[1]) {
    const identifier = parts[1].toUpperCase();
    const [projectKey, numStr] = identifier.split("-");
    const number = parseInt(numStr, 10);

    if (!projectKey || Number.isNaN(number)) {
      return {
        response_type: "ephemeral",
        text: `Invalid card identifier format "${parts[1]}". Expected format like "PROJ-12".`,
      };
    }

    const card = await db.card.findFirst({
      where: {
        number,
        project: { key: projectKey },
      },
      include: {
        project: true,
        column: true,
      },
    });

    if (!card) {
      return {
        response_type: "ephemeral",
        text: `Card ${identifier} was not found.`,
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

    return {
      response_type: "in_channel",
      text: `${identifier}: ${card.title}`,
      blocks: unfurl.blocks,
    };
  }

  if (subCommand === "create" || subCommand === "new") {
    let projectKey: string | null = null;
    let title: string = "";

    if (subCommand === "create" && parts.length >= 3) {
      projectKey = parts[1].toUpperCase();
      title = parts.slice(2).join(" ");
    } else {
      title = parts.slice(1).join(" ");
    }

    if (!title.trim()) {
      return {
        response_type: "ephemeral",
        text: "Please provide a title for the card. Example: `/opm new Fix login bug`",
      };
    }

    // Find the project
    const project = projectKey
      ? await db.project.findFirst({
          where: { key: projectKey },
          include: { columns: { orderBy: { order: "asc" } }, user: true },
        })
      : await db.project.findFirst({
          orderBy: { createdAt: "asc" },
          include: { columns: { orderBy: { order: "asc" } }, user: true },
        });

    if (!project) {
      return {
        response_type: "ephemeral",
        text: projectKey
          ? `Project with key "${projectKey}" not found.`
          : "No projects exist yet. Please create a project in Open Project Manager first.",
      };
    }

    if (project.columns.length === 0) {
      return {
        response_type: "ephemeral",
        text: `Project "${project.name}" has no columns to place the card in.`,
      };
    }

    const targetColumn =
      project.columns.find((c) => c.group === "BACKLOG") ||
      project.columns.find((c) => c.group === "UNSTARTED") ||
      project.columns.find((c) => !c.isDone) ||
      project.columns[0];

    const lastCard = await db.card.findFirst({
      where: { columnId: targetColumn.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const order = (lastCard?.order ?? 0) + 10000;

    const actor = params.user_name ? `Slack: @${params.user_name}` : "Slack Integration";

    const created = await withCardNumberRetry(project.id, 1, async (cardNumber) => {
      return db.$transaction(async (tx) => {
        const card = await tx.card.create({
          data: {
            projectId: project.id,
            columnId: targetColumn.id,
            title: title.trim(),
            number: cardNumber,
            order,
            owner: actor,
          },
        });

        const activity: ActivityEntry[] = [
          {
            cardId: card.id,
            actorUserId: project.userId,
            type: "card_created",
            toValue: title.trim(),
          },
        ];
        await createActivities(tx, activity);

        return { card, activity };
      });
    });

    notifyActivity(project.id, created.activity);

    const identifier = `${project.key}-${created.card.number}`;
    return {
      response_type: "in_channel",
      text: `Created card *${identifier}* in *${project.name}*: "${title.trim()}"`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Created card *${identifier}* in *${project.name}* (${targetColumn.name})\n*${title.trim()}*`,
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
