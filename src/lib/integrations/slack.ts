import crypto from "crypto";
import { db } from "@/lib/db";
import { verifyApiTokenOnly } from "@/lib/auth";
import { createCard } from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";
import { isClosedColumn } from "@/lib/columnGroups";

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

/**
 * Decodes Slack mrkdwn entities into clean plain text for card titles.
 * Replaces mentions (<@U123|name> -> @name), channels (<#C123|chan> -> #chan),
 * links (<http://...|label> -> label), and HTML entities (&amp;, &lt;, &gt;).
 */
export function decodeSlackText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => (name ? `@${name}` : "@user"))
    .replace(/<#[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => (name ? `#${name}` : "#channel"))
    .replace(/<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g, (_, url, label) => label || url)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
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

  const user = await db.user.findUnique({
    where: { id: record.localId },
    select: { id: true, name: true, email: true, tokenVersion: true },
  });
  if (!user) {
    await db.importRecord.deleteMany({ where: { id: record.id } });
    return null;
  }

  // Active token verification: ensure the API token used to establish the link
  // has not been revoked or expired.
  if (record.importRunId && record.importRunId !== "slack-link") {
    const apiToken = await db.apiToken.findUnique({
      where: { id: record.importRunId },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!apiToken || apiToken.userId !== user.id || (apiToken.expiresAt && apiToken.expiresAt < new Date())) {
      await db.importRecord.deleteMany({ where: { id: record.id } });
      return null;
    }
  }

  return user;
}

export async function linkSlackUser(slackUserId: string, opmUserId: string, apiTokenId = "slack-link") {
  await db.$transaction(async (tx) => {
    // Clear any existing mappings for this Slack user so one Slack account holds exactly one link
    await tx.importRecord.deleteMany({
      where: {
        source: "slack",
        entityType: "user",
        sourceId: slackUserId,
      },
    });

    await tx.importRecord.create({
      data: {
        userId: opmUserId,
        source: "slack",
        entityType: "user",
        sourceId: slackUserId,
        localId: opmUserId,
        importRunId: apiTokenId,
      },
    });
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
  projectName?: string;
  priority?: string | null;
  owner?: string | null;
  assignees?: string | null;
  points?: number | null;
  url: string;
}) {
  const priority = card.priority && card.priority !== "NONE" ? card.priority : "None";
  const assignee = card.assignees || card.owner || "Unassigned";
  const points = card.points != null ? `${card.points} pts` : "None";
  const safeTitle = escapeSlackMrkdwn(card.title);
  const safeIdentifier = escapeSlackMrkdwn(card.identifier);

  const fullUrl = card.url.startsWith("http")
    ? card.url
    : `${getAppBaseUrl()}${card.url.startsWith("/") ? "" : "/"}${card.url}`;

  const headerText = card.projectName
    ? `*<${fullUrl}|${safeIdentifier}: ${safeTitle}>* in *${escapeSlackMrkdwn(card.projectName)}*`
    : `*<${fullUrl}|${safeIdentifier}: ${safeTitle}>*`;

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: headerText,
        },
        fields: [
          { type: "mrkdwn", text: `*Status:*\n${escapeSlackMrkdwn(card.status)}` },
          { type: "mrkdwn", text: `*Priority:*\n${priority}` },
          { type: "mrkdwn", text: `*Assignee:*\n${escapeSlackMrkdwn(assignee)}` },
          { type: "mrkdwn", text: `*Points:*\n${points}` },
        ],
      },
    ],
  };
}

interface OwnedProjectLike {
  id: string;
  user: { name: string | null; email: string };
}

function parseOwnerTarget(
  raw: string,
  formatExample: string
): { ownerFilter: string | null; value: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed.includes("/")) {
    return { ownerFilter: null, value: trimmed };
  }

  const slashIdx = trimmed.indexOf("/");
  const owner = trimmed.slice(0, slashIdx).trim().toLowerCase();
  const value = trimmed.slice(slashIdx + 1).trim();

  if (!owner || !value || value.includes("/")) {
    return {
      error: `Invalid target format "${raw}". Expected ${formatExample}.`,
    };
  }

  return { ownerFilter: owner, value };
}

function filterByOwner<T>(
  items: T[],
  ownerFilter: string,
  getProject: (item: T) => OwnedProjectLike
): { match: T } | { ambiguous: T[] } | { notFound: true } {
  const needle = ownerFilter.toLowerCase();

  const exactMatches = items.filter((item) => {
    const p = getProject(item);
    const email = p.user.email.toLowerCase();
    const localPart = email.split("@")[0] || "";
    const name = p.user.name?.toLowerCase() || "";
    return (
      p.id.toLowerCase() === needle ||
      email === needle ||
      localPart === needle ||
      name === needle
    );
  });

  if (exactMatches.length === 1) return { match: exactMatches[0] };
  if (exactMatches.length > 1) return { ambiguous: exactMatches };

  const prefixMatches = items.filter((item) => {
    const p = getProject(item);
    const email = p.user.email.toLowerCase();
    const name = p.user.name?.toLowerCase() || "";
    return email.startsWith(needle) || name.startsWith(needle);
  });

  if (prefixMatches.length === 1) return { match: prefixMatches[0] };
  if (prefixMatches.length > 1) return { ambiguous: prefixMatches };

  return { notFound: true };
}

async function resolveProject(target: string, opmUserId: string) {
  const parsed = parseOwnerTarget(target, '"<KEY>" or "<owner>/<KEY>"');
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  const { ownerFilter, value: keyOrId } = parsed;

  // 1. Try resolving by projectId directly (respecting ownerFilter if specified)
  const byId = await db.project.findFirst({
    where: {
      id: keyOrId,
      isArchived: false,
      OR: [
        { userId: opmUserId },
        { members: { some: { userId: opmUserId, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
      ],
    },
    include: {
      columns: { orderBy: { order: "asc" } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (byId) {
    if (!ownerFilter) return { project: byId };
    const matchedById = filterByOwner([byId], ownerFilter, (p) => p);
    if ("match" in matchedById) return { project: matchedById.match };
    return {
      error: `No project "${keyOrId}" owned by "${ownerFilter}" found.`,
    };
  }

  // 2. Query candidates by key
  const candidates = await db.project.findMany({
    where: {
      key: keyOrId.toUpperCase(),
      isArchived: false,
      OR: [
        { userId: opmUserId },
        { members: { some: { userId: opmUserId, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
      ],
    },
    include: {
      columns: { orderBy: { order: "asc" } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (candidates.length === 0) {
    return { error: `Project "${target}" not found or you do not have permission to create cards in it.` };
  }

  if (ownerFilter) {
    const filtered = filterByOwner(candidates, ownerFilter, (p) => p);
    if ("match" in filtered) return { project: filtered.match };
    if ("ambiguous" in filtered) {
      const owners = filtered.ambiguous.map((p) => p.user.email).join(", ");
      return {
        error: `Multiple projects with key "${keyOrId.toUpperCase()}" match owner "${ownerFilter}" (${owners}). Please specify the full owner email or project ID.`,
      };
    }
    return { error: `No project with key "${keyOrId.toUpperCase()}" owned by "${ownerFilter}" found.` };
  }

  // If no owner filter specified, prefer owned project
  const owned = candidates.find((p) => p.userId === opmUserId);
  if (owned) return { project: owned };

  if (candidates.length === 1) return { project: candidates[0] };

  // Ambiguous: multiple shared projects with same key
  const owners = candidates.map((p) => p.user.name || p.user.email).join(", ");
  return {
    error: `Multiple projects match key "${keyOrId.toUpperCase()}" (owned by: ${owners}). Please specify owner (e.g. \`/opm create <owner>/${keyOrId.toUpperCase()} <title>\`).`,
  };
}

async function createCardInProject(
  project: {
    id: string;
    key: string;
    name: string;
    columns: Array<{ id: string; name: string; group?: string | null; isDone?: boolean | null }>;
  },
  rawTitle: string,
  opmUser: { id: string; name: string | null; email: string }
) {
  if (project.columns.length === 0) {
    return {
      response_type: "ephemeral" as const,
      text: `Project "${project.name}" has no columns to place the card in.`,
    };
  }

  const targetColumn =
    project.columns.find((c) => c.group === "BACKLOG") ||
    project.columns.find((c) => c.group === "UNSTARTED") ||
    project.columns.find((c) => !isClosedColumn(c)) ||
    project.columns[0];

  const title = decodeSlackText(rawTitle);

  const result = await createCard(
    {
      projectId: project.id,
      columnId: targetColumn.id,
      title,
      owner: (opmUser.name || opmUser.email).slice(0, 200),
      assigneeIds: [opmUser.id],
    },
    opmUser.id
  );

  if (!result.success || !result.data) {
    return {
      response_type: "ephemeral" as const,
      text: `Failed to create card: ${("error" in result ? result.error : undefined) || "Unknown error"}`,
    };
  }

  const createdCard = result.data;
  const identifier = `${project.key}-${createdCard.number}`;
  const safeTitle = escapeSlackMrkdwn(title);
  const safeProjectName = escapeSlackMrkdwn(project.name);

  return {
    response_type: "ephemeral" as const,
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
      text:
        "Open Project Manager Slack Commands:\n" +
        "• `/opm help` - Show this help message\n" +
        "• `/opm link <api-token>` - Link your Slack account to Open Project Manager using an API token\n" +
        "• `/opm whoami` - Check your linked Open Project Manager account\n" +
        "• `/opm unlink` - Unlink your Slack account\n" +
        "• `/opm new <title>` - Create a card in your default/first project\n" +
        "• `/opm create <KEY> <title>` - Create a card in a specific project key (or `owner/KEY`)\n" +
        "• `/opm get <KEY-123>` - Look up a card by its identifier (or `owner/KEY-123`)\n",
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

    const apiTokenAuth = await verifyApiTokenOnly(token);
    if (!apiTokenAuth) {
      return {
        response_type: "ephemeral",
        text: "Invalid or expired API token. Please generate a new API token in your User Profile modal in Open Project Manager.",
      };
    }

    await linkSlackUser(params.user_id, apiTokenAuth.session.userId, apiTokenAuth.apiTokenId);
    return {
      response_type: "ephemeral",
      text: `Successfully linked your Slack account to Open Project Manager as *${escapeSlackMrkdwn(apiTokenAuth.session.name)}* (${apiTokenAuth.session.email}).`,
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
      text: `You are linked as *${escapeSlackMrkdwn(opmUser.name || "")}* (${opmUser.email}) in Open Project Manager.`,
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
        text: "Usage: `/opm get <KEY-123>` or `/opm get <owner/KEY-123>`. Example: `/opm get ENG-5`",
      };
    }

    const parsedTarget = parseOwnerTarget(parts[1], '"PROJ-12" or "owner/PROJ-12"');
    if ("error" in parsedTarget) {
      return {
        response_type: "ephemeral",
        text: parsedTarget.error,
      };
    }

    const { ownerFilter, value: identifierArg } = parsedTarget;

    const match = identifierArg.toUpperCase().match(/^([A-Z0-9]+)-(\d{1,9})$/);
    if (!match) {
      return {
        response_type: "ephemeral",
        text: `Invalid card identifier format "${parts[1]}". Expected format like "PROJ-12" or "owner/PROJ-12".`,
      };
    }

    const projectKey = match[1];
    const number = parseInt(match[2], 10);
    const identifier = `${projectKey}-${number}`;

    // Scoped to projects accessible to the user (including INTERNAL visibility)
    const matchingCards = await db.card.findMany({
      where: {
        number,
        isArchived: false,
        project: {
          key: projectKey,
          isArchived: false,
          OR: [
            { userId: opmUser.id },
            { members: { some: { userId: opmUser.id } } },
            { visibility: "INTERNAL" },
          ],
        },
      },
      include: {
        project: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        column: true,
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    let card = null;
    if (ownerFilter) {
      const filtered = filterByOwner(matchingCards, ownerFilter, (c) => c.project);
      if ("ambiguous" in filtered) {
        const owners = filtered.ambiguous.map((c) => c.project.user.email).join(", ");
        return {
          response_type: "ephemeral",
          text: `Multiple projects with card "${identifier}" match owner "${ownerFilter}" (${owners}). Please specify the full owner email or project ID.`,
        };
      }
      if ("match" in filtered) {
        card = filtered.match;
      }
    } else {
      const owned = matchingCards.find((c) => c.project.userId === opmUser.id);
      if (owned) {
        card = owned;
      } else if (matchingCards.length === 1) {
        card = matchingCards[0];
      }
    }

    if (!card) {
      if (matchingCards.length > 1 && !ownerFilter) {
        const owners = matchingCards.map((c) => c.project.user.name || c.project.user.email).join(", ");
        return {
          response_type: "ephemeral",
          text: `Multiple projects have card "${identifier}" (owned by: ${owners}). Please disambiguate with \`/opm get <owner>/${identifier}\`.`,
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

    const assigneesText =
      card.assignees && card.assignees.length > 0
        ? card.assignees.map((a) => a.user.name || a.user.email).join(", ")
        : card.owner || null;

    const unfurl = formatCardUnfurl({
      identifier,
      title: card.title,
      status: card.column.name,
      projectName: card.project.name,
      priority: card.priority,
      owner: card.owner,
      assignees: assigneesText,
      points: card.points,
      url: `/projects/${card.projectId}`,
    });

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
        text: "Usage: `/opm create <KEY> <title>` or `/opm create <owner/KEY> <title>`. Example: `/opm create ENG Fix navigation bar`",
      };
    }

    const targetKey = parts[1];
    const rawTitle = parts.slice(2).join(" ").trim();
    if (!rawTitle) {
      return {
        response_type: "ephemeral",
        text: "Please provide a title for the card. Example: `/opm create ENG Fix navigation bar`",
      };
    }

    const resolution = await resolveProject(targetKey, opmUser.id);
    if ("error" in resolution && resolution.error) {
      return {
        response_type: "ephemeral",
        text: resolution.error,
      };
    }

    return await createCardInProject(resolution.project!, rawTitle, opmUser);
  }

  if (subCommand === "new") {
    const rawTitle = parts.slice(1).join(" ").trim();
    if (!rawTitle) {
      return {
        response_type: "ephemeral",
        text: "Please provide a title for the card. Example: `/opm new Fix login bug`",
      };
    }

    // Prefer owned active project first, then shared writable project
    const candidates = await db.project.findMany({
      where: {
        isArchived: false,
        columns: { some: {} },
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { columns: { orderBy: { order: "asc" } } },
    });

    const project = candidates.find((p) => p.userId === opmUser.id) || candidates[0];

    if (!project) {
      return {
        response_type: "ephemeral",
        text: "You do not have access to any active writable projects in Open Project Manager.",
      };
    }

    return await createCardInProject(project, rawTitle, opmUser);
  }

  return {
    response_type: "ephemeral",
    text: `Unknown command "${subCommand}". Type \`/opm help\` for available commands.`,
  };
}
