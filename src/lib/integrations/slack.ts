import crypto from "crypto";
import { db } from "@/lib/db";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
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
  await db.importRecord.upsert({
    where: {
      userId_source_entityType_sourceId: {
        userId: opmUserId,
        source: "slack",
        entityType: "user",
        sourceId: slackUserId,
      },
    },
    create: {
      userId: opmUserId,
      source: "slack",
      entityType: "user",
      sourceId: slackUserId,
      localId: opmUserId,
      importRunId: "slack-link",
    },
    update: {
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
        "• `/opm link <tokenOrEmail>` - Link your Slack account to Open Project Manager\n" +
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
    const tokenOrEmail = parts[1];
    if (!tokenOrEmail) {
      return {
        response_type: "ephemeral",
        text: "Usage: `/opm link <api-token>` (create an API token in your OPM User Profile) or `/opm link <email>`.",
      };
    }

    if (!params.user_id) {
      return { response_type: "ephemeral", text: "Missing Slack user ID." };
    }

    let targetUser: any = await db.apiToken.findFirst({
      where: { id: tokenOrEmail },
      include: { user: true },
    }).then((t) => t?.user);

    if (!targetUser) {
      targetUser = await db.user.findUnique({
        where: { email: tokenOrEmail.toLowerCase().trim() },
      });
    }

    if (!targetUser) {
      return {
        response_type: "ephemeral",
        text: `No matching user or valid token found for "${tokenOrEmail}".`,
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

    // Scoped to projects accessible to the user
    const card = await db.card.findFirst({
      where: {
        number,
        project: {
          key: projectKey,
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

    if (!card) {
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

    // Find the project scoped to projects accessible by the linked user
    let project: any = null;
    if (projectKey) {
      const candidates = await db.project.findMany({
        where: {
          key: projectKey,
          OR: [
            { userId: opmUser.id },
            { members: { some: { userId: opmUser.id } } },
          ],
        },
        include: { columns: { orderBy: { order: "asc" } }, user: true },
      });
      project = candidates.find((p) => p.userId === opmUser.id) || candidates[0] || null;
    } else {
      project = await db.project.findFirst({
        where: {
          OR: [
            { userId: opmUser.id },
            { members: { some: { userId: opmUser.id } } },
          ],
        },
        orderBy: { createdAt: "asc" },
        include: { columns: { orderBy: { order: "asc" } }, user: true },
      });
    }

    if (!project) {
      return {
        response_type: "ephemeral",
        text: projectKey
          ? `Project with key "${projectKey}" not found or you do not have permission to access it.`
          : "You do not have access to any projects in Open Project Manager.",
      };
    }

    // Role check: must have at least MEMBER access
    const canCreate = await verifyProjectAccess(project.id, opmUser.id, "MEMBER");
    if (!canCreate) {
      return {
        response_type: "ephemeral",
        text: `You do not have permission to create cards in project "${project.name}".`,
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

    const lastCard = await db.card.findFirst({
      where: { columnId: targetColumn.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const order = (lastCard?.order ?? 0) + 10000;

    const actor = opmUser.name || opmUser.email;

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
            actorUserId: opmUser.id,
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
    const safeTitle = escapeSlackMrkdwn(title.trim());
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
