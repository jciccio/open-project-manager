import crypto from "crypto";
import { db } from "@/lib/db";
import { verifyApiTokenOnly } from "@/lib/auth";
import { createCard, moveCard } from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";
import { isClosedColumn } from "@/lib/columnGroups";

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
    allowed_mentions?: { parse: string[] };
  };
}

export interface DiscordInteraction {
  id: string;
  type: number; // 1 = PING, 2 = APPLICATION_COMMAND
  application_id?: string;
  token?: string;
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

export const DISCORD_MAX_CONTENT_LENGTH = 2000;
export const DISCORD_MAX_EMBED_FIELD_VALUE = 1024;
export const DISCORD_LINK_CODE_PREFIX = "opm_dl_";
export const DISCORD_LINK_CODE_TTL_MS = 10 * 60 * 1000;
const DISCORD_LIST_CARDS_PER_COLUMN = 30;

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
  if (record.importRunId && record.importRunId !== "discord-link") {
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

export async function linkDiscordUser(discordUserId: string, opmUserId: string, apiTokenId = "discord-link") {
  await db.$transaction(async (tx) => {
    await tx.importRecord.deleteMany({
      where: {
        source: "discord",
        entityType: "user",
        sourceId: discordUserId,
      },
    });

    await tx.importRecord.create({
      data: {
        userId: opmUserId,
        source: "discord",
        entityType: "user",
        sourceId: discordUserId,
        localId: opmUserId,
        importRunId: apiTokenId,
      },
    });
  });
}

function hashDiscordLinkCode(rawCode: string): string {
  return crypto.createHash("sha256").update(rawCode, "utf8").digest("hex");
}

/**
 * Generates a short-lived, single-use link code for `/opm link <code>`.
 * Stores only the SHA-256 hash and deletes prior unused codes for the same user.
 */
export async function issueDiscordLinkCode(opmUserId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = `${DISCORD_LINK_CODE_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  const codeHash = hashDiscordLinkCode(code);
  const expiresAt = new Date(Date.now() + DISCORD_LINK_CODE_TTL_MS);

  await db.$transaction(async (tx) => {
    await tx.importRecord.deleteMany({
      where: {
        userId: opmUserId,
        source: "discord",
        entityType: "link_code",
      },
    });

    await tx.importRecord.create({
      data: {
        userId: opmUserId,
        source: "discord",
        entityType: "link_code",
        sourceId: codeHash,
        localId: opmUserId,
        importRunId: String(expiresAt.getTime()),
      },
    });
  });

  return { code, expiresAt };
}

/**
 * Atomically consumes a short-lived link code inside a transaction so it can
 * only be redeemed once before expiration.
 */
export async function consumeDiscordLinkCode(
  rawCode: string
): Promise<{ id: string; name: string | null; email: string } | null> {
  if (!rawCode.startsWith(DISCORD_LINK_CODE_PREFIX)) return null;
  const codeHash = hashDiscordLinkCode(rawCode);

  return await db.$transaction(async (tx) => {
    const record = await tx.importRecord.findFirst({
      where: {
        source: "discord",
        entityType: "link_code",
        sourceId: codeHash,
      },
    });
    if (!record) return null;

    const deleted = await tx.importRecord.deleteMany({
      where: { id: record.id },
    });
    if (deleted.count !== 1) return null;

    const expiresMs = Number(record.importRunId);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      return null;
    }

    return await tx.user.findUnique({
      where: { id: record.localId },
      select: { id: true, name: true, email: true },
    });
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

function truncateDiscordFieldValue(value: string, maxLen = DISCORD_MAX_EMBED_FIELD_VALUE): string {
  if (!value) return "None";
  if (value.length <= maxLen) return value;
  return value.slice(0, Math.max(0, maxLen - 3)) + "...";
}

function formatBoundedAssigneeField(assigneeText: string, maxLen = DISCORD_MAX_EMBED_FIELD_VALUE): string {
  if (!assigneeText) return "Unassigned";
  if (assigneeText.length <= maxLen) return assigneeText;

  const entries = assigneeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length <= 1) {
    return truncateDiscordFieldValue(assigneeText, maxLen);
  }

  const kept: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const remaining = entries.length - (i + 1);
    const suffix = remaining > 0 ? `, ... (+${remaining} more)` : "";
    const candidate = (kept.length > 0 ? `${kept.join(", ")}, ` : "") + entries[i] + suffix;
    if (candidate.length > maxLen) {
      if (kept.length === 0) {
        const onlyFirstSuffix = `, ... (+${entries.length - 1} more)`;
        const room = Math.max(4, maxLen - onlyFirstSuffix.length);
        return entries[0].slice(0, room - 3) + "..." + onlyFirstSuffix;
      }
      return `${kept.join(", ")}, ... (+${entries.length - i} more)`;
    }
    kept.push(entries[i]);
  }

  return truncateDiscordFieldValue(kept.join(", "), maxLen);
}

export function formatDiscordCardEmbed(card: {
  identifier: string;
  title: string;
  status: string;
  projectName: string;
  priority?: string | null;
  owner?: string | null;
  assignees?: string | null;
  points?: number | null;
  url: string;
}): DiscordEmbed {
  const priority = card.priority && card.priority !== "NONE" ? card.priority : "None";
  const assignee = formatBoundedAssigneeField(card.assignees || card.owner || "Unassigned");
  const points = card.points != null ? `${card.points} pts` : "None";

  const fullUrl = card.url.startsWith("http")
    ? card.url
    : `${getAppBaseUrl()}${card.url.startsWith("/") ? "" : "/"}${card.url}`;

  // Discord caps embed titles at 256 characters
  let title = `${card.identifier}: ${card.title}`;
  if (title.length > 256) {
    title = title.slice(0, 253) + "...";
  }

  return {
    title,
    url: fullUrl,
    color: 0x5865f2, // Discord Blurple
    fields: [
      { name: "Project", value: truncateDiscordFieldValue(card.projectName), inline: true },
      { name: "Status", value: truncateDiscordFieldValue(card.status), inline: true },
      { name: "Priority", value: truncateDiscordFieldValue(priority), inline: true },
      { name: "Assignee", value: assignee, inline: true },
      { name: "Points", value: truncateDiscordFieldValue(points), inline: true },
    ],
    footer: { text: "Open Project Manager" },
    timestamp: new Date().toISOString(),
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

async function resolveDiscordProject(target: string, opmUserId: string) {
  const parsed = parseOwnerTarget(target, '"<key>" or "<owner>/<key>"');
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const { ownerFilter, value: keyOrId } = parsed;

  // 1. Try resolving by projectId directly (respecting ownerFilter if given)
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
    const matched = filterByOwner([byId], ownerFilter, (p) => p);
    if ("match" in matched) return { project: matched.match };
    return { error: `No project "${keyOrId}" owned by "${ownerFilter}" found.` };
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

  // Prefer owned project
  const owned = candidates.find((p) => p.userId === opmUserId);
  if (owned) return { project: owned };

  if (candidates.length === 1) return { project: candidates[0] };

  const owners = candidates.map((p) => p.user.name || p.user.email).join(", ");
  return {
    error: `Multiple projects match key "${keyOrId.toUpperCase()}" (owned by: ${owners}). Please specify owner (e.g. \`<owner>/${keyOrId.toUpperCase()}\`).`,
  };
}

/**
 * Resolves lightweight project metadata only (no columns or cards loaded) so
 * `/opm columns` and `/opm list` avoid fetching cards for non-selected projects.
 */
async function resolveDiscordProjectForViewing(target: string, opmUserId: string) {
  const parsed = parseOwnerTarget(target, '"<key>" or "<owner>/<key>"');
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const { ownerFilter, value: keyOrId } = parsed;

  const projectSelect = {
    id: true,
    key: true,
    name: true,
    userId: true,
    user: { select: { id: true, name: true, email: true } },
  } as const;

  // 1. Try resolving by projectId directly
  const byId = await db.project.findFirst({
    where: {
      id: keyOrId,
      isArchived: false,
      OR: [
        { userId: opmUserId },
        { members: { some: { userId: opmUserId } } },
        { visibility: "INTERNAL" },
      ],
    },
    select: projectSelect,
  });
  if (byId) {
    if (!ownerFilter) return { project: byId };
    const matched = filterByOwner([byId], ownerFilter, (p) => p);
    if ("match" in matched) return { project: matched.match };
    return { error: `No project "${keyOrId}" owned by "${ownerFilter}" found.` };
  }

  // 2. Query lightweight candidates by key
  const candidates = await db.project.findMany({
    where: {
      key: keyOrId.toUpperCase(),
      isArchived: false,
      OR: [
        { userId: opmUserId },
        { members: { some: { userId: opmUserId } } },
        { visibility: "INTERNAL" },
      ],
    },
    select: projectSelect,
  });

  if (candidates.length === 0) {
    return { error: `Project with key "${target}" not found or you do not have permission to view it.` };
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

  const owned = candidates.find((p) => p.userId === opmUserId);
  if (owned) return { project: owned };

  if (candidates.length === 1) return { project: candidates[0] };

  const owners = candidates.map((p) => p.user.name || p.user.email).join(", ");
  return {
    error: `Multiple projects match key "${keyOrId.toUpperCase()}" (owned by: ${owners}). Please specify owner (e.g. \`<owner>/${keyOrId.toUpperCase()}\`).`,
  };
}

async function createCardInDiscordProject(
  project: {
    id: string;
    key: string;
    name: string;
    columns: Array<{ id: string; name: string; group?: string | null; isDone?: boolean | null }>;
  },
  title: string,
  opmUser: { id: string; name: string | null; email: string }
): Promise<DiscordInteractionResponse> {
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
    project.columns.find((c) => c.group === "BACKLOG") ||
    project.columns.find((c) => c.group === "UNSTARTED") ||
    project.columns.find((c) => !isClosedColumn(c)) ||
    project.columns[0];

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
      type: 4,
      data: {
        content: `Failed to create card: ${("error" in result ? result.error : undefined) || "Unknown error"}`,
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
    assignees: opmUser.name || opmUser.email,
    points: createdCard.points,
    url: `/projects/${project.id}`,
  });

  return {
    type: 4,
    data: {
      content: `Created card **${identifier}** in **${project.name}**:`,
      embeds: [embed],
      flags: 64, // Ephemeral to protect privacy
      allowed_mentions: { parse: [] },
    },
  };
}

interface ColumnListSection {
  name: string;
  totalCount: number;
  cards: Array<{ number: number; title: string }>;
}

function buildOmittedNotice(count: number, unit: "card" | "column"): string {
  if (unit === "card") {
    return `_... and ${count} more ${count === 1 ? "card" : "cards"}_`;
  }
  return `_... and ${count} more ${count === 1 ? "column" : "columns"} omitted_`;
}

function formatBoundedColumnsContent(
  projectName: string,
  projectKey: string,
  columns: Array<{ id: string; name: string; isDone: boolean }>
): string {
  const header = `**Columns in ${projectName} (${projectKey})**:\n`;
  const lines: string[] = [];

  for (let idx = 0; idx < columns.length; idx++) {
    const c = columns[idx];
    const line = `${idx + 1}. **${c.name}** (\`${c.id}\`)${c.isDone ? " *(Done)*" : ""}`;
    const remainingAfter = columns.length - (idx + 1);
    const reserve = remainingAfter > 0 ? `\n${buildOmittedNotice(remainingAfter, "column")}` : "";
    const candidate = header + [...lines, line].join("\n") + reserve;
    if (candidate.length > DISCORD_MAX_CONTENT_LENGTH) {
      const omitNotice = buildOmittedNotice(columns.length - idx, "column");
      if ((header + [...lines, omitNotice].join("\n")).length <= DISCORD_MAX_CONTENT_LENGTH) {
        lines.push(omitNotice);
      }
      break;
    }
    lines.push(line);
  }

  return (header + lines.join("\n")).slice(0, DISCORD_MAX_CONTENT_LENGTH);
}

function formatBoundedOpenCardsContent(
  projectName: string,
  projectKey: string,
  columnSections: ColumnListSection[]
): string {
  const header = `**Open Cards in ${projectName} (${projectKey})**:\n\n`;
  const sections: string[] = [];

  const fits = (candidateSections: string[], trailingNotice = "") => {
    const body = candidateSections.join("\n\n");
    const extra = trailingNotice ? (candidateSections.length > 0 ? "\n\n" : "") + trailingNotice : "";
    return header.length + body.length + extra.length <= DISCORD_MAX_CONTENT_LENGTH;
  };

  for (let colIdx = 0; colIdx < columnSections.length; colIdx++) {
    const col = columnSections[colIdx];
    const colHeader = `**${col.name}** (${col.totalCount}):\n`;
    const remainingColsHere = columnSections.length - colIdx;
    const omitColsHere = buildOmittedNotice(remainingColsHere, "column");
    const remainingColsAfter = columnSections.length - (colIdx + 1);
    const nextColReserve =
      remainingColsAfter > 0 ? buildOmittedNotice(remainingColsAfter, "column") : "";

    if (col.cards.length === 0) {
      const emptySection = `${colHeader}_No cards_`;
      if (!fits([...sections, emptySection], nextColReserve)) {
        if (fits(sections, omitColsHere)) {
          sections.push(omitColsHere);
        }
        break;
      }
      sections.push(emptySection);
      continue;
    }

    const onlyCardTruncSection = `${colHeader}${buildOmittedNotice(col.totalCount, "card")}`;
    if (!fits([...sections, onlyCardTruncSection], nextColReserve)) {
      if (fits(sections, omitColsHere)) {
        sections.push(omitColsHere);
      }
      break;
    }

    const cardLines: string[] = [];
    let truncatedInCol = false;

    for (let i = 0; i < col.cards.length; i++) {
      const c = col.cards[i];
      const cardTitle = c.title.length > 60 ? c.title.slice(0, 57) + "..." : c.title;
      const cardLine = `• \`${projectKey}-${c.number}\` - ${cardTitle}`;
      const remainingAfterCard = col.totalCount - (i + 1);
      const tailInCol =
        remainingAfterCard > 0 ? `\n${buildOmittedNotice(remainingAfterCard, "card")}` : "";
      const candidateSection = colHeader + [...cardLines, cardLine].join("\n") + tailInCol;

      if (!fits([...sections, candidateSection], nextColReserve)) {
        cardLines.push(buildOmittedNotice(col.totalCount - i, "card"));
        truncatedInCol = true;
        break;
      }
      cardLines.push(cardLine);
    }

    if (!truncatedInCol && col.cards.length < col.totalCount) {
      cardLines.push(buildOmittedNotice(col.totalCount - col.cards.length, "card"));
      truncatedInCol = true;
    }

    sections.push(colHeader + cardLines.join("\n"));

    if (truncatedInCol) {
      if (nextColReserve && fits(sections, nextColReserve)) {
        sections.push(nextColReserve);
      }
      break;
    }
  }

  const content = `${header}${sections.join("\n\n")}`;
  return content.length <= DISCORD_MAX_CONTENT_LENGTH
    ? content
    : content.slice(0, DISCORD_MAX_CONTENT_LENGTH - 3) + "...";
}

function pickDisambiguatedCard<T extends { project: OwnedProjectLike & { userId: string } }>(
  matchingCards: T[],
  ownerFilter: string | null,
  opmUserId: string,
  identifier: string,
  commandVerb: "get" | "move",
  notFoundVerb: "view" | "move"
): { card: T } | { error: string } {
  if (ownerFilter) {
    const filtered = filterByOwner(matchingCards, ownerFilter, (c) => c.project);
    if ("match" in filtered) return { card: filtered.match };
    if ("ambiguous" in filtered) {
      const owners = filtered.ambiguous.map((c) => c.project.user.email).join(", ");
      return {
        error: `Multiple projects with card "${identifier}" match owner "${ownerFilter}" (${owners}). Please specify the full owner email or project ID.`,
      };
    }
    return {
      error: `Card ${identifier} was not found or you do not have permission to ${notFoundVerb} it.`,
    };
  }

  const owned = matchingCards.find((c) => c.project.userId === opmUserId);
  if (owned) return { card: owned };

  if (matchingCards.length === 1) return { card: matchingCards[0] };

  if (matchingCards.length > 1) {
    const owners = matchingCards.map((c) => c.project.user.name || c.project.user.email).join(", ");
    const syntax =
      commandVerb === "move"
        ? `\`/opm move <owner>/${identifier} <column>\``
        : `\`/opm get <owner>/${identifier}\``;
    return {
      error: `Multiple projects match card "${identifier}" (owned by: ${owners}). Please disambiguate with ${syntax}.`,
    };
  }

  return {
    error: `Card ${identifier} was not found or you do not have permission to ${notFoundVerb} it.`,
  };
}

function parseCardIdentifierInput(
  rawInput: string
):
  | { ownerFilter: string | null; projectKey: string; number: number; identifier: string }
  | { error: string } {
  const parsed = parseOwnerTarget(rawInput, '"PROJ-12" or "owner/PROJ-12"');
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const match = parsed.value.toUpperCase().match(/^([A-Z0-9]+)-(\d{1,9})$/);
  if (!match) {
    return {
      error: `Invalid card identifier format "${rawInput}". Expected format like "PROJ-12" or "owner/PROJ-12".`,
    };
  }
  const projectKey = match[1];
  const number = parseInt(match[2], 10);
  return {
    ownerFilter: parsed.ownerFilter,
    projectKey,
    number,
    identifier: `${projectKey}-${number}`,
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
          "• `/opm link <code-or-token>`: Link your Discord account using a short-lived link code (`POST /api/v1/integrations/discord/link-code`, recommended) or an API token.\n" +
          "• `/opm whoami`: Check which OPM user is linked to your Discord account.\n" +
          "• `/opm unlink`: Unlink your Discord account.\n" +
          "• `/opm list <key>`: List open cards in a project grouped by column (supports `owner/key`).\n" +
          "• `/opm columns <key>`: List available columns in a project (supports `owner/key`).\n" +
          "• `/opm get <KEY-123>`: Inspect a card's status, priority, and assignment (supports `owner/KEY-123`).\n" +
          "• `/opm move <KEY-123> <column>`: Move a card to a specified column.\n" +
          "• `/opm create <key> <title>`: Create a card in a specific project (supports `owner/key`).\n" +
          "• `/opm new <title>`: Quick-create a card in your default active writable project.",
        flags: 64,
      },
    };
  }

  if (subCommand === "link") {
    const credential = String(subArgs.code || subArgs.token || "").trim();
    if (!credential) {
      return {
        type: 4,
        data: {
          content:
            "Usage: `/opm link <code-or-token>` — generate a short-lived single-use code via `POST /api/v1/integrations/discord/link-code` (recommended) or pass an API token from your User Profile.",
          flags: 64,
        },
      };
    }

    if (credential.startsWith(DISCORD_LINK_CODE_PREFIX)) {
      const linkedUser = await consumeDiscordLinkCode(credential);
      if (!linkedUser) {
        return {
          type: 4,
          data: {
            content:
              "Invalid, expired, or already used Discord link code. Generate a new code via `POST /api/v1/integrations/discord/link-code`.",
            flags: 64,
          },
        };
      }

      await linkDiscordUser(discordUser.id, linkedUser.id, "discord-link");
      return {
        type: 4,
        data: {
          content: `Successfully linked your Discord account to Open Project Manager as **${linkedUser.name || linkedUser.email}** (${linkedUser.email}). This link is independent of your API tokens.`,
          flags: 64,
        },
      };
    }

    const apiTokenAuth = await verifyApiTokenOnly(credential);
    if (!apiTokenAuth) {
      return {
        type: 4,
        data: {
          content:
            "Invalid or expired API token. Use a short-lived link code (`POST /api/v1/integrations/discord/link-code`) or generate a new API token in your OPM User Profile.",
          flags: 64,
        },
      };
    }

    await linkDiscordUser(discordUser.id, apiTokenAuth.session.userId, apiTokenAuth.apiTokenId);
    return {
      type: 4,
      data: {
        content:
          `Successfully linked your Discord account to Open Project Manager as **${apiTokenAuth.session.name}** (${apiTokenAuth.session.email}). ` +
          `Tip: deleting or expiring this API token will also unlink Discord; use a short-lived link code (\`POST /api/v1/integrations/discord/link-code\`) to avoid keeping an API token active.`,
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
    const rawInput = String(subArgs.identifier || subArgs.card || "").trim();
    if (!rawInput) {
      return {
        type: 4,
        data: {
          content: 'Usage: `/opm get <KEY-123>`. Example: `/opm get ENG-12`',
          flags: 64,
        },
      };
    }

    const parsedId = parseCardIdentifierInput(rawInput);
    if ("error" in parsedId) {
      return {
        type: 4,
        data: {
          content: parsedId.error,
          flags: 64,
        },
      };
    }

    const { ownerFilter, projectKey, number, identifier } = parsedId;

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

    const picked = pickDisambiguatedCard(matchingCards, ownerFilter, opmUser.id, identifier, "get", "view");
    if ("error" in picked) {
      return {
        type: 4,
        data: {
          content: picked.error,
          flags: 64,
        },
      };
    }
    const card = picked.card;

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

    const assigneesText =
      card.assignees && card.assignees.length > 0
        ? card.assignees.map((a) => a.user.name || a.user.email).join(", ")
        : card.owner || null;

    const embed = formatDiscordCardEmbed({
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
      type: 4,
      data: {
        embeds: [embed],
        flags: 64, // Ephemeral view
      },
    };
  }

  if (subCommand === "columns") {
    const rawKey = String(subArgs.key || subArgs.project || "").trim();
    if (!rawKey) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm columns <key>`. Example: `/opm columns ENG`",
          flags: 64,
        },
      };
    }

    const resolution = await resolveDiscordProjectForViewing(rawKey, opmUser.id);
    if ("error" in resolution && resolution.error) {
      return {
        type: 4,
        data: {
          content: resolution.error,
          flags: 64,
        },
      };
    }

    const project = resolution.project!;
    const columns = await db.column.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, isDone: true },
    });

    if (columns.length === 0) {
      return {
        type: 4,
        data: {
          content: `Project **${project.name}** has no columns.`,
          flags: 64,
        },
      };
    }

    return {
      type: 4,
      data: {
        content: formatBoundedColumnsContent(project.name, project.key, columns),
        flags: 64,
      },
    };
  }

  if (subCommand === "list") {
    const rawKey = String(subArgs.key || subArgs.project || "").trim();
    if (!rawKey) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm list <key>`. Example: `/opm list ENG`",
          flags: 64,
        },
      };
    }

    const resolution = await resolveDiscordProjectForViewing(rawKey, opmUser.id);
    if ("error" in resolution && resolution.error) {
      return {
        type: 4,
        data: {
          content: resolution.error,
          flags: 64,
        },
      };
    }

    const project = resolution.project!;
    const columns = await db.column.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, group: true, isDone: true },
    });

    const openColumns = columns.filter((c) => !isClosedColumn(c));
    const targetColumns = openColumns.length > 0 ? openColumns : columns;

    if (targetColumns.length === 0) {
      return {
        type: 4,
        data: {
          content: `No open cards found in project **${project.name}** (\`${project.key}\`).`,
          flags: 64,
        },
      };
    }

    const targetColIds = targetColumns.map((c) => c.id);
    const counts = await db.card.groupBy({
      by: ["columnId"],
      where: {
        columnId: { in: targetColIds },
        isArchived: false,
      },
      _count: { _all: true },
    });

    const countByColumnId = new Map(counts.map((row) => [row.columnId, row._count._all]));
    const totalCards = counts.reduce((sum, row) => sum + row._count._all, 0);

    if (totalCards === 0) {
      return {
        type: 4,
        data: {
          content: `No open cards found in project **${project.name}** (\`${project.key}\`).`,
          flags: 64,
        },
      };
    }

    // Fetch only bounded cards for non-empty target columns (never closed columns)
    const cardsPerColumn = await Promise.all(
      targetColumns.map(async (col) => {
        const total = countByColumnId.get(col.id) || 0;
        if (total === 0) return [];
        return await db.card.findMany({
          where: { columnId: col.id, isArchived: false },
          orderBy: { order: "asc" },
          select: { number: true, title: true },
          take: DISCORD_LIST_CARDS_PER_COLUMN,
        });
      })
    );

    const sections: ColumnListSection[] = targetColumns.map((col, idx) => ({
      name: col.name,
      totalCount: countByColumnId.get(col.id) || 0,
      cards: cardsPerColumn[idx],
    }));

    return {
      type: 4,
      data: {
        content: formatBoundedOpenCardsContent(project.name, project.key, sections),
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    };
  }

  if (subCommand === "move") {
    const rawId = String(subArgs.identifier || subArgs.card || "").trim();
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

    const parsedId = parseCardIdentifierInput(rawId);
    if ("error" in parsedId) {
      return {
        type: 4,
        data: {
          content: parsedId.error,
          flags: 64,
        },
      };
    }

    const { ownerFilter, projectKey, number, identifier } = parsedId;

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

    const picked = pickDisambiguatedCard(matchingCards, ownerFilter, opmUser.id, identifier, "move", "move");
    if ("error" in picked) {
      return {
        type: 4,
        data: {
          content: picked.error,
          flags: 64,
        },
      };
    }
    const card = picked.card;

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

    const assigneesText =
      card.assignees && card.assignees.length > 0
        ? card.assignees.map((a) => a.user.name || a.user.email).join(", ")
        : card.owner || null;

    const embed = formatDiscordCardEmbed({
      identifier,
      title: card.title,
      status: destColumn.name,
      projectName: card.project.name,
      priority: card.priority,
      owner: card.owner,
      assignees: assigneesText,
      points: card.points,
      url: `/projects/${card.projectId}`,
    });

    return {
      type: 4,
      data: {
        content: `Moved **${identifier}** to **${destColumn.name}**:`,
        embeds: [embed],
        flags: 64, // Ephemeral to protect privacy
        allowed_mentions: { parse: [] },
      },
    };
  }

  if (subCommand === "create") {
    const rawKey = String(subArgs.key || subArgs.project || "").trim();
    const title = String(subArgs.title || "").trim();
    if (!rawKey || !title) {
      return {
        type: 4,
        data: {
          content: "Usage: `/opm create <key> <title>`. Example: `/opm create ENG Fix navigation bar`",
          flags: 64,
        },
      };
    }

    const resolution = await resolveDiscordProject(rawKey, opmUser.id);
    if ("error" in resolution && resolution.error) {
      return {
        type: 4,
        data: {
          content: resolution.error,
          flags: 64,
        },
      };
    }

    return await createCardInDiscordProject(resolution.project!, title, opmUser);
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
        type: 4,
        data: {
          content: "You do not have access to any active writable projects in Open Project Manager.",
          flags: 64,
        },
      };
    }

    return await createCardInDiscordProject(project, title, opmUser);
  }

  return {
    type: 4,
    data: {
      content: `Unknown subcommand "${subCommand}". Type \`/opm help\` for available commands.`,
      flags: 64,
    },
  };
}
