import crypto from "crypto";
import { db } from "@/lib/db";
import { authenticateBearerToken } from "@/lib/auth";
import { createCard, moveCard } from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordInteractionResponse {
  type: number; // 1 = PONG, 4 = CHANNEL_MESSAGE_WITH_SOURCE
  data?: {
    content?: string;
    embeds?: DiscordEmbed[];
    flags?: number; // 64 = EPHEMERAL
  };
}

export interface DiscordInteraction {
  id: string;
  type: number; // 1 = PING, 2 = APPLICATION_COMMAND
  data?: {
    id?: string;
    name: string;
    options?: Array<{
      name: string;
      type: number;
      value?: string | number;
      options?: Array<{
        name: string;
        type: number;
        value: string | number;
      }>;
    }>;
  };
  user?: { id: string; username: string };
  member?: { user: { id: string; username: string } };
}

export function getAppBaseUrl(): string {
  const url = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return url.replace(/\/$/, "");
}

/**
 * Validates Discord interaction signature using Ed25519.
 */
export function verifyDiscordSignature(options: {
  publicKey: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
}): boolean {
  const { publicKey, signature, timestamp, rawBody } = options;
  if (!publicKey || !signature || !timestamp || !rawBody) return false;

  // Replay attack prevention: must be within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (Number.isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
    return false;
  }

  try {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const keyBytes = Buffer.from(publicKey, "hex");
    if (keyBytes.length !== 32) return false;

    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, keyBytes]),
      format: "der",
      type: "spki",
    });

    const msg = Buffer.concat([Buffer.from(timestamp, "utf-8"), Buffer.from(rawBody, "utf-8")]);
    const sigBytes = Buffer.from(signature, "hex");
    if (sigBytes.length !== 64) return false;

    return crypto.verify(null, msg, keyObject, sigBytes);
  } catch {
    return false;
  }
}

export async function getLinkedOpmUser(discordUserId: string) {
  if (!discordUserId) return null;
  const record = await db.importRecord.findFirst({
    where: {
      source: "discord",
      entityType: "user",
      sourceId: discordUserId,
    },
  });
  if (!record) return null;
  return db.user.findUnique({ where: { id: record.localId } });
}

export async function linkDiscordUser(discordUserId: string, opmUserId: string) {
  await db.importRecord.deleteMany({
    where: {
      source: "discord",
      entityType: "user",
      sourceId: discordUserId,
    },
  });

  await db.importRecord.create({
    data: {
      userId: opmUserId,
      source: "discord",
      entityType: "user",
      sourceId: discordUserId,
      localId: opmUserId,
      importRunId: "discord-link",
    },
  });
}

export async function unlinkDiscordUser(discordUserId: string) {
  await db.importRecord.deleteMany({
    where: {
      source: "discord",
      entityType: "user",
      sourceId: discordUserId,
    },
  });
}

export function formatDiscordCardEmbed(card: {
  identifier: string;
  title: string;
  status: string;
  projectName: string;
  priority?: string | null;
  owner?: string | null;
  points?: number | null;
  url: string;
}): DiscordEmbed {
  const priority = card.priority && card.priority !== "NONE" ? card.priority : "None";
  const owner = card.owner || "Unassigned";
  const points = card.points != null ? `${card.points} pts` : "None";

  const fullUrl = card.url.startsWith("http")
    ? card.url
    : `${getAppBaseUrl()}${card.url.startsWith("/") ? "" : "/"}${card.url}`;

  return {
    title: `${card.identifier}: ${card.title}`,
    url: fullUrl,
    color: 0x5865f2, // Discord Blurple
    fields: [
      { name: "Project", value: card.projectName, inline: true },
      { name: "Status", value: card.status, inline: true },
      { name: "Priority", value: priority, inline: true },
      { name: "Assignee", value: owner, inline: true },
      { name: "Points", value: points, inline: true },
    ],
    footer: { text: "Open Project Manager" },
    timestamp: new Date().toISOString(),
  };
}

export async function handleDiscordInteraction(
  interaction: DiscordInteraction
): Promise<DiscordInteractionResponse> {
  // 1. Handle PING
  if (interaction.type === 1) {
    return { type: 1 };
  }

  // 2. Handle Application Command
  if (interaction.type !== 2 || !interaction.data) {
    return {
      type: 4,
      data: {
        content: "Unsupported interaction type.",
        flags: 64,
      },
    };
  }

  const discordUser = interaction.member?.user || interaction.user;
  if (!discordUser) {
    return {
      type: 4,
      data: {
        content: "Unable to determine Discord user identity.",
        flags: 64,
      },
    };
  }

  const options = interaction.data.options || [];
  const subCommandObj = options[0];
  const subCommand = subCommandObj ? subCommandObj.name.toLowerCase() : "help";
  const subArgs = (subCommandObj?.options || []).reduce<Record<string, string | number>>((acc, opt) => {
    acc[opt.name] = opt.value;
    return acc;
  }, {});

  if (subCommand === "help") {
    return {
      type: 4,
      data: {
        content:
          "**Open Project Manager Discord Bot**\n\n" +
          "• `/opm link <token>`: Link your Discord account to your OPM user using an API token from your profile.\n" +
          "• `/opm whoami`: Check which OPM user is linked to your Discord account.\n" +
          "• `/opm unlink`: Unlink your Discord account.\n" +
          "• `/opm list <key>`: List open cards in a project grouped by column.\n" +
          "• `/opm columns <key>`: List available columns in a project.\n" +
          "• `/opm get <KEY-123>`: Inspect a card's status, priority, and assignment.\n" +
          "• `/opm move <KEY-123> <column>`: Move a card to a specified column.\n" +
          "• `/opm create <key> <title>`: Create a card in a specific project.\n" +
          "• `/opm new <title>`: Quick-create a card in your oldest active writable project.",
        flags: 64,
      },
    };
  }

  if (subCommand === "link") {
    const token = String(subArgs.token || "").trim();
    if (!token) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm link <token>` (generate an API token in your OPM User Profile modal).",
          flags: 64,
        },
      };
    }

    const session = await authenticateBearerToken(token);
    if (!session) {
      return {
        type: 4,
        data: {
          content: "Invalid or expired API token. Please generate a new API token in your OPM User Profile.",
          flags: 64,
        },
      };
    }

    const targetUser = await db.user.findUnique({ where: { id: session.userId } });
    if (!targetUser) {
      return {
        type: 4,
        data: {
          content: "User account associated with this token could not be found.",
          flags: 64,
        },
      };
    }

    await linkDiscordUser(discordUser.id, targetUser.id);
    return {
      type: 4,
      data: {
        content: `Successfully linked your Discord account to Open Project Manager as **${targetUser.name}** (${targetUser.email}).`,
        flags: 64,
      },
    };
  }

  // All subsequent commands require an active link
  const opmUser = await getLinkedOpmUser(discordUser.id);
  if (!opmUser) {
    return {
      type: 4,
      data: {
        content: "Your Discord account is not linked to Open Project Manager. Please link first using `/opm link <token>`.",
        flags: 64,
      },
    };
  }

  if (subCommand === "whoami") {
    return {
      type: 4,
      data: {
        content: `You are linked as **${opmUser.name}** (${opmUser.email}) in Open Project Manager.`,
        flags: 64,
      },
    };
  }

  if (subCommand === "unlink") {
    await unlinkDiscordUser(discordUser.id);
    return {
      type: 4,
      data: {
        content: "Successfully unlinked your Discord account from Open Project Manager.",
        flags: 64,
      },
    };
  }

  if (subCommand === "get") {
    const rawId = String(subArgs.identifier || "").trim().toUpperCase();
    const match = rawId.match(/^([A-Z0-9]+)-(\d{1,9})$/);
    if (!match) {
      return {
        type: 4,
        data: {
          content: `Invalid card identifier format "${rawId}". Expected format like "PROJ-12".`,
          flags: 64,
        },
      };
    }

    const projectKey = match[1];
    const number = parseInt(match[2], 10);
    const identifier = `${projectKey}-${number}`;

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
          type: 4,
          data: {
            content: `Multiple active projects match key "${projectKey}". Please contact support to disambiguate.`,
            flags: 64,
          },
        };
      }
      return {
        type: 4,
        data: {
          content: `Card ${identifier} was not found or you do not have permission to view it.`,
          flags: 64,
        },
      };
    }

    const canView = await verifyProjectAccess(card.projectId, opmUser.id, "VIEWER");
    if (!canView) {
      return {
        type: 4,
        data: {
          content: `Card ${identifier} was not found or you do not have permission to view it.`,
          flags: 64,
        },
      };
    }

    const embed = formatDiscordCardEmbed({
      identifier,
      title: card.title,
      status: card.column.name,
      projectName: card.project.name,
      priority: card.priority,
      owner: card.owner,
      points: card.points,
      url: `/projects/${card.projectId}?cardId=${card.id}`,
    });

    return {
      type: 4,
      data: {
        embeds: [embed],
        flags: 64, // Ephemeral view
      },
    };
  }

  if (subCommand === "columns") {
    const projectKey = String(subArgs.key || subArgs.project || "").trim().toUpperCase();
    if (!projectKey) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm columns <key>`. Example: `/opm columns ENG`",
          flags: 64,
        },
      };
    }

    const candidates = await db.project.findMany({
      where: {
        key: projectKey,
        isArchived: false,
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id } } },
        ],
      },
      include: { columns: { orderBy: { order: "asc" } } },
    });

    const project = candidates.find((p) => p.userId === opmUser.id) || (candidates.length === 1 ? candidates[0] : null);
    if (!project) {
      if (candidates.length > 1) {
        return {
          type: 4,
          data: {
            content: `Multiple active projects match key "${projectKey}". Please contact support to disambiguate.`,
            flags: 64,
          },
        };
      }
      return {
        type: 4,
        data: {
          content: `Project with key "${projectKey}" not found or you do not have permission to view it.`,
          flags: 64,
        },
      };
    }

    if (project.columns.length === 0) {
      return {
        type: 4,
        data: {
          content: `Project **${project.name}** has no columns.`,
          flags: 64,
        },
      };
    }

    const lines = project.columns.map(
      (c, idx) => `${idx + 1}. **${c.name}** (\`${c.id}\`)${c.isDone ? " *(Done)*" : ""}`
    );
    return {
      type: 4,
      data: {
        content: `**Columns in ${project.name} (${project.key})**:\n${lines.join("\n")}`,
        flags: 64,
      },
    };
  }

  if (subCommand === "list") {
    const projectKey = String(subArgs.key || subArgs.project || "").trim().toUpperCase();
    if (!projectKey) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm list <key>`. Example: `/opm list ENG`",
          flags: 64,
        },
      };
    }

    const candidates = await db.project.findMany({
      where: {
        key: projectKey,
        isArchived: false,
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id } } },
        ],
      },
      include: {
        columns: {
          orderBy: { order: "asc" },
          include: {
            cards: {
              where: { isArchived: false },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    const project = candidates.find((p) => p.userId === opmUser.id) || (candidates.length === 1 ? candidates[0] : null);
    if (!project) {
      if (candidates.length > 1) {
        return {
          type: 4,
          data: {
            content: `Multiple active projects match key "${projectKey}". Please contact support to disambiguate.`,
            flags: 64,
          },
        };
      }
      return {
        type: 4,
        data: {
          content: `Project with key "${projectKey}" not found or you do not have permission to view it.`,
          flags: 64,
        },
      };
    }

    const openColumns = project.columns.filter((c) => !c.isDone);
    const targetColumns = openColumns.length > 0 ? openColumns : project.columns;

    const sections: string[] = [];
    let totalCards = 0;
    for (const col of targetColumns) {
      const colCards = col.cards;
      totalCards += colCards.length;
      const cardLines =
        colCards.length > 0
          ? colCards.map((c) => `• \`${project.key}-${c.number}\` - ${c.title}`).join("\n")
          : "_No cards_";
      sections.push(`**${col.name}** (${colCards.length}):\n${cardLines}`);
    }

    if (totalCards === 0) {
      return {
        type: 4,
        data: {
          content: `No open cards found in project **${project.name}** (\`${project.key}\`).`,
          flags: 64,
        },
      };
    }

    return {
      type: 4,
      data: {
        content: `**Open Cards in ${project.name} (${project.key})**:\n\n${sections.join("\n\n")}`,
        flags: 64,
      },
    };
  }

  if (subCommand === "move") {
    const rawId = String(subArgs.identifier || subArgs.card || "").trim().toUpperCase();
    const targetColInput = String(subArgs.column || subArgs.destination || subArgs.to || "").trim();

    if (!rawId || !targetColInput) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm move <KEY-123> <column>`. Example: `/opm move ENG-12 In Progress`",
          flags: 64,
        },
      };
    }

    const match = rawId.match(/^([A-Z0-9]+)-(\d{1,9})$/);
    if (!match) {
      return {
        type: 4,
        data: {
          content: `Invalid card identifier format "${rawId}". Expected format like "PROJ-12".`,
          flags: 64,
        },
      };
    }

    const projectKey = match[1];
    const number = parseInt(match[2], 10);
    const identifier = `${projectKey}-${number}`;

    const matchingCards = await db.card.findMany({
      where: {
        number,
        isArchived: false,
        project: {
          key: projectKey,
          isArchived: false,
          OR: [
            { userId: opmUser.id },
            { members: { some: { userId: opmUser.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
          ],
        },
      },
      include: {
        project: {
          include: {
            columns: { orderBy: { order: "asc" } },
          },
        },
        column: true,
      },
    });

    const card = matchingCards.find((c) => c.project.userId === opmUser.id) || (matchingCards.length === 1 ? matchingCards[0] : null);
    if (!card) {
      if (matchingCards.length > 1) {
        return {
          type: 4,
          data: {
            content: `Multiple active projects match key "${projectKey}". Please contact support to disambiguate.`,
            flags: 64,
          },
        };
      }
      return {
        type: 4,
        data: {
          content: `Card ${identifier} was not found or you do not have permission to move it.`,
          flags: 64,
        },
      };
    }

    const canMove = await verifyProjectAccess(card.projectId, opmUser.id, "MEMBER");
    if (!canMove) {
      return {
        type: 4,
        data: {
          content: `Card ${identifier} was not found or you do not have permission to move it.`,
          flags: 64,
        },
      };
    }

    const columns = card.project.columns;
    const destColumn = columns.find(
      (c) => c.id === targetColInput || c.name.toLowerCase() === targetColInput.toLowerCase()
    );

    if (!destColumn) {
      return {
        type: 4,
        data: {
          content: `Column "${targetColInput}" not found in project ${card.project.key}. Use \`/opm columns ${card.project.key}\` to see available columns.`,
          flags: 64,
        },
      };
    }

    if (destColumn.id === card.columnId) {
      return {
        type: 4,
        data: {
          content: `Card **${identifier}** is already in column **${card.column.name}**.`,
          flags: 64,
        },
      };
    }

    const lastCard = await db.card.findFirst({
      where: { columnId: destColumn.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const newOrder = lastCard ? lastCard.order + 1 : 0;

    const moveResult = await moveCard(card.id, destColumn.id, newOrder, opmUser.id);
    if (!moveResult.success) {
      return {
        type: 4,
        data: {
          content: `Failed to move card: ${moveResult.error || "Unknown error"}`,
          flags: 64,
        },
      };
    }

    const embed = formatDiscordCardEmbed({
      identifier,
      title: card.title,
      status: destColumn.name,
      projectName: card.project.name,
      priority: card.priority,
      owner: card.owner,
      points: card.points,
      url: `/projects/${card.projectId}?cardId=${card.id}`,
    });

    return {
      type: 4,
      data: {
        content: `Moved **${identifier}** to **${destColumn.name}**:`,
        embeds: [embed],
      },
    };
  }

  if (subCommand === "create") {
    const projectKey = String(subArgs.key || "").trim().toUpperCase();
    const title = String(subArgs.title || "").trim();
    if (!projectKey || !title) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm create <key> <title>`. Example: `/opm create ENG Fix navigation bar`",
          flags: 64,
        },
      };
    }

    const candidates = await db.project.findMany({
      where: {
        key: projectKey,
        isArchived: false,
        OR: [
          { userId: opmUser.id },
          { members: { some: { userId: opmUser.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
        ],
      },
      include: { columns: { orderBy: { order: "asc" } } },
    });

    const project = candidates.find((p) => p.userId === opmUser.id) || (candidates.length === 1 ? candidates[0] : null);
    if (!project) {
      if (candidates.length > 1) {
        return {
          type: 4,
          data: {
            content: `Multiple active projects match key "${projectKey}". Please specify a unique project.`,
            flags: 64,
          },
        };
      }
      return {
        type: 4,
        data: {
          content: `Project with key "${projectKey}" not found or you do not have permission to create cards in it.`,
          flags: 64,
        },
      };
    }

    if (project.columns.length === 0) {
      return {
        type: 4,
        data: {
          content: `Project "${project.name}" has no columns to place the card in.`,
          flags: 64,
        },
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
        type: 4,
        data: {
          content: `Failed to create card: ${result.error || "Unknown error"}`,
          flags: 64,
        },
      };
    }

    const createdCard = result.data;
    const identifier = `${project.key}-${createdCard.number}`;
    const embed = formatDiscordCardEmbed({
      identifier,
      title: createdCard.title,
      status: targetColumn.name,
      projectName: project.name,
      priority: createdCard.priority,
      owner: createdCard.owner,
      points: createdCard.points,
      url: `/projects/${project.id}?cardId=${createdCard.id}`,
    });

    return {
      type: 4,
      data: {
        content: `Created card **${identifier}** in **${project.name}**:`,
        embeds: [embed],
      },
    };
  }

  if (subCommand === "new") {
    const title = String(subArgs.title || "").trim();
    if (!title) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm new <title>`. Example: `/opm new Fix login bug`",
          flags: 64,
        },
      };
    }

    const project = await db.project.findFirst({
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

    if (!project) {
      return {
        type: 4,
        data: {
          content: "You do not have access to any active writable projects in Open Project Manager.",
          flags: 64,
        },
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
        type: 4,
        data: {
          content: `Failed to create card: ${result.error || "Unknown error"}`,
          flags: 64,
        },
      };
    }

    const createdCard = result.data;
    const identifier = `${project.key}-${createdCard.number}`;
    const embed = formatDiscordCardEmbed({
      identifier,
      title: createdCard.title,
      status: targetColumn.name,
      projectName: project.name,
      priority: createdCard.priority,
      owner: createdCard.owner,
      points: createdCard.points,
      url: `/projects/${project.id}?cardId=${createdCard.id}`,
    });

    return {
      type: 4,
      data: {
        content: `Created card **${identifier}** in **${project.name}**:`,
        embeds: [embed],
      },
    };
  }

  return {
    type: 4,
    data: {
      content: `Unknown subcommand "${subCommand}". Type \`/opm help\` for available commands.`,
      flags: 64,
    },
  };
}
