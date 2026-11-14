import crypto from "crypto";
import { db } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/import/htmlToMarkdown";
import { createCard } from "@/lib/services/cards";
import { verifyProjectAccess } from "@/lib/permissions";
import { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/validation/cards";

export const MAX_EMAIL_BODY_BYTES = 1024 * 1024; // 1 MB cap to protect event loop
export const MAX_RECIPIENT_HEADER_CHARS = 64 * 1024; // 64 KB cap for To/Cc recipient lists
export const MAX_SENDER_HEADER_CHARS = 2000;
export const FALLBACK_DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour window when Message-ID is absent

export interface InboundEmailPayload {
  to: string;
  from: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  messageId?: string;
  message_id?: string;
}

export interface InboundEmailResult {
  success: boolean;
  accepted?: boolean;
  duplicate?: boolean;
  error?: string;
  card?: {
    id: string;
    projectId: string;
    number: number;
    title: string;
    columnId: string;
    identifier: string;
  };
}

/**
 * Checks whether an SPF, DKIM, or DMARC verdict represents a non-passing or failure status.
 * Matches exact, padded, and composite values containing failure/non-pass tokens.
 */
export function isFailingAuthVerdict(verdict?: string | null): boolean {
  if (!verdict || typeof verdict !== "string") return false;
  return /\b(fail|softfail|none|neutral|permerror|temperror|policy|nxdomain)\b/i.test(verdict);
}

function extractDkimPassedDomains(dkim: string): string[] {
  const domains: string[] = [];
  const compositeRegex = /@([a-zA-Z0-9.-]+)\s*:\s*pass\b/gi;
  let match: RegExpExecArray | null;
  while ((match = compositeRegex.exec(dkim)) !== null) {
    domains.push(match[1].toLowerCase());
  }
  const headerDMatch = /\bheader\.d=([a-zA-Z0-9.-]+)\b/i.exec(dkim);
  if (headerDMatch && /\bpass\b/i.test(dkim)) {
    domains.push(headerDMatch[1].toLowerCase());
  }
  return domains;
}

function domainsAlign(signingDomain: string, fromDomain: string): boolean {
  const cleanSigning = signingDomain.toLowerCase();
  const cleanFrom = fromDomain.toLowerCase();
  return cleanSigning === cleanFrom || cleanSigning.endsWith(`.${cleanFrom}`);
}

/**
 * Enforces explicit SPF/DKIM/DMARC verdicts and From-domain alignment on unverified webhook deliveries.
 */
export function validateWebhookAuthVerdicts(
  payload: InboundEmailPayload
): { valid: true } | { valid: false; error: string } {
  if (isFailingAuthVerdict(payload.spf)) {
    return { valid: false, error: "Inbound email rejected: SPF validation failed" };
  }
  if (isFailingAuthVerdict(payload.dkim)) {
    return { valid: false, error: "Inbound email rejected: DKIM validation failed" };
  }
  if (isFailingAuthVerdict(payload.dmarc)) {
    return { valid: false, error: "Inbound email rejected: DMARC validation failed" };
  }

  const dmarcNorm = payload.dmarc?.trim().toLowerCase();
  if (dmarcNorm) {
    if (dmarcNorm === "pass") {
      return { valid: true };
    }
    return { valid: false, error: "Inbound email rejected: DMARC validation failed" };
  }

  const senderEmail = extractSenderEmail(payload.from);
  if (!senderEmail) {
    return { valid: false, error: "Inbound email rejected: DMARC pass or aligned DKIM validation required" };
  }
  const fromDomain = senderEmail.slice(senderEmail.lastIndexOf("@") + 1).toLowerCase();
  const passedDomains = payload.dkim ? extractDkimPassedDomains(payload.dkim) : [];
  if (passedDomains.some((d) => domainsAlign(d, fromDomain))) {
    return { valid: true };
  }

  return {
    valid: false,
    error: "Inbound email rejected: DMARC pass or domain-aligned DKIM pass required",
  };
}

/**
 * Strips comments from an RFC 5322 string, respecting quoted strings.
 * Returns null if quotes or parentheses are unbalanced.
 */
function stripComments(input: string): string | null {
  let result = "";
  let inQuote = false;
  let commentDepth = 0;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escapeNext) {
      if (commentDepth === 0) {
        result += char;
      }
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      if (commentDepth === 0) {
        result += char;
      }
      continue;
    }

    if (char === '"' && commentDepth === 0) {
      inQuote = !inQuote;
      result += char;
      continue;
    }

    if (!inQuote) {
      if (char === "(") {
        commentDepth++;
        continue;
      }
      if (char === ")") {
        if (commentDepth === 0) return null; // Unbalanced
        commentDepth--;
        continue;
      }
    }

    if (commentDepth === 0) {
      result += char;
    }
  }

  if (inQuote || commentDepth > 0 || escapeNext) return null;
  return result;
}

/**
 * Splits comma-separated mailboxes respecting quoted strings.
 */
function splitMailboxes(input: string): string[] | null {
  const mailboxes: string[] = [];
  let current = "";
  let inQuote = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      current += char;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (char === "," && !inQuote) {
      const trimmed = current.trim();
      if (trimmed) mailboxes.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  if (inQuote || escapeNext) return null;
  const trimmed = current.trim();
  if (trimmed) mailboxes.push(trimmed);
  return mailboxes;
}

/**
 * Parses a single RFC 5322 mailbox into its canonical local-part@domain address.
 */
function parseMailboxAddress(mailbox: string): string | null {
  let angleStart = -1;
  let angleEnd = -1;
  let inQuote = false;
  let escapeNext = false;

  for (let i = 0; i < mailbox.length; i++) {
    const char = mailbox[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (char === "<") {
        if (angleStart !== -1) return null;
        angleStart = i;
      } else if (char === ">") {
        if (angleStart === -1 || angleEnd !== -1) return null;
        angleEnd = i;
      }
    }
  }

  if (inQuote || escapeNext) return null;

  let rawAddr: string;
  if (angleStart !== -1) {
    if (angleEnd <= angleStart) return null;
    const trailing = mailbox.slice(angleEnd + 1).trim();
    if (trailing.length > 0) return null;
    rawAddr = mailbox.slice(angleStart + 1, angleEnd).trim();
  } else {
    rawAddr = mailbox.trim();
  }

  const atIndex = rawAddr.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === rawAddr.length - 1) return null;

  const localPart = rawAddr.slice(0, atIndex);
  const domain = rawAddr.slice(atIndex + 1);

  const domainRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!domainRegex.test(domain) && domain !== "localhost" && domain !== "opm.local") {
    return null;
  }

  const unquotedLocalRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  const quotedLocalRegex = /^"([^"\\]|\\.)+"$/;
  if (!unquotedLocalRegex.test(localPart) && !quotedLocalRegex.test(localPart)) {
    return null;
  }

  return `${localPart.toLowerCase()}@${domain.toLowerCase()}`;
}

function extractKeyFromLocalPart(localPart: string): string | null {
  const plusIdx = localPart.indexOf("+");
  if (plusIdx !== -1) {
    const prefix = localPart.slice(0, plusIdx).toLowerCase();
    const remainder = localPart.slice(plusIdx + 1).trim();
    if (prefix === "opm" || prefix === "task") {
      const key = remainder.split("+")[0].trim();
      return /^[A-Za-z0-9_-]+$/.test(key) ? key.toUpperCase() : null;
    }
    return /^[A-Za-z0-9_-]+$/.test(prefix) ? prefix.toUpperCase() : null;
  }
  return /^[A-Za-z0-9_-]+$/.test(localPart) ? localPart.toUpperCase() : null;
}

function isAllowedDefaultDomain(domain: string): boolean {
  return (
    domain === "opm.local" ||
    domain.endsWith(".opm.local") ||
    domain === "localhost" ||
    domain.endsWith(".localhost")
  );
}

/**
 * Extracts a project key from a recipient address or list of addresses.
 * When `INBOUND_EMAIL_DOMAIN` is set, restricts matching exclusively to that domain (or subdomains).
 * When unset, restricts matching to reserved local domains (`opm.local`, `localhost`) to avoid
 * unintended routing from third-party addresses such as `task+X@gmail.com`.
 */
export function extractProjectKeyFromRecipient(recipient: string): string | null {
  if (!recipient || typeof recipient !== "string") return null;

  // Split raw mailboxes first so one malformed mailbox with bad comments or syntax
  // does not drop the entire recipient list.
  const rawMailboxes = splitMailboxes(recipient);
  if (!rawMailboxes || rawMailboxes.length === 0) return null;

  const parsedAddresses: { localPart: string; domain: string }[] = [];
  for (const mb of rawMailboxes) {
    const stripped = stripComments(mb);
    if (!stripped) continue; // Skip malformed mailbox and continue with remaining

    const parsed = parseMailboxAddress(stripped);
    if (parsed) {
      const atIdx = parsed.lastIndexOf("@");
      parsedAddresses.push({
        localPart: parsed.slice(0, atIdx),
        domain: parsed.slice(atIdx + 1),
      });
    }
  }

  if (parsedAddresses.length === 0) return null;

  const configuredDomain = (process.env.INBOUND_EMAIL_DOMAIN || "").toLowerCase().trim();

  for (const addr of parsedAddresses) {
    const matchesDomain = configuredDomain
      ? addr.domain === configuredDomain || addr.domain.endsWith("." + configuredDomain)
      : isAllowedDefaultDomain(addr.domain);
    if (!matchesDomain) continue;

    const key = extractKeyFromLocalPart(addr.localPart);
    if (key) return key;
  }

  return null;
}

/**
 * Extracts clean email address from sender RFC 5322 string.
 * Strips comments, parses quotes, and strictly rejects headers that do not resolve to exactly one mailbox.
 */
export function extractSenderEmail(sender: string): string | null {
  if (!sender || typeof sender !== "string") return null;

  const noComments = stripComments(sender);
  if (!noComments) return null;

  const mailboxes = splitMailboxes(noComments);
  if (!mailboxes || mailboxes.length !== 1) return null;

  return parseMailboxAddress(mailboxes[0]);
}

function stripMarkdownImages(markdown: string): string {
  // Neutralize any inline markdown image (![alt](url)) so remote tracking pixels do not fire on render
  return markdown.replace(/!\[([^\]]*)\]\([^)\n]+\)/g, (_match, alt: string) => {
    const cleanAlt = alt.trim();
    return cleanAlt ? `[Image: ${cleanAlt}]` : "";
  });
}

export async function processInboundEmail(
  payload: InboundEmailPayload,
  sessionUser?: { id: string; email: string } | null
): Promise<InboundEmailResult> {
  // Reject oversized payloads early to protect event loop and return 200 rejected rather than 400 retries
  if (
    (payload.text && payload.text.length > MAX_EMAIL_BODY_BYTES) ||
    (payload.html && payload.html.length > MAX_EMAIL_BODY_BYTES)
  ) {
    return {
      success: false,
      accepted: false,
      error: "Inbound email rejected: email body exceeds maximum size limit",
    };
  }

  if (
    payload.to.length > MAX_RECIPIENT_HEADER_CHARS ||
    (payload.cc && payload.cc.length > MAX_RECIPIENT_HEADER_CHARS) ||
    (!sessionUser && payload.from.length > MAX_SENDER_HEADER_CHARS)
  ) {
    return {
      success: false,
      accepted: false,
      error: "Inbound email rejected: email header exceeds maximum size limit",
    };
  }

  const combinedRecipient = [payload.to, payload.cc].filter(Boolean).join(", ");
  const projectKey = extractProjectKeyFromRecipient(combinedRecipient);
  if (!projectKey) {
    return {
      success: false,
      accepted: false,
      error: `Could not extract project key from recipient address: "${combinedRecipient}"`,
    };
  }

  let senderUser: { id: string; email: string; name: string | null } | null = null;
  if (sessionUser) {
    senderUser = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true, name: true },
    });
  } else {
    const senderEmail = extractSenderEmail(payload.from);
    if (!senderEmail) {
      return {
        success: false,
        accepted: false,
        error: `Invalid or missing sender email address in from: "${payload.from}"`,
      };
    }
    senderUser = await db.user.findUnique({
      where: { email: senderEmail },
      select: { id: true, email: true, name: true },
    });
  }

  if (!senderUser) {
    console.warn(`[inbound-email] Sender is not a registered user`);
    return {
      success: false,
      accepted: false,
      error: "Inbound email rejected: project not found or sender unauthorized",
    };
  }

  // Look up candidate projects matching key where sender is owner, admin or active member
  const candidateProjects = await db.project.findMany({
    where: {
      key: projectKey,
      isArchived: false,
      OR: [
        { userId: senderUser.id },
        { members: { some: { userId: senderUser.id, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } },
      ],
    },
    include: {
      columns: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (candidateProjects.length === 0) {
    console.warn(`[inbound-email] No project with key "${projectKey}" found accessible by sender "${senderUser.email}"`);
    return {
      success: false,
      accepted: false,
      error: "Inbound email rejected: project not found or sender unauthorized",
    };
  }

  if (candidateProjects.length > 1) {
    console.warn(`[inbound-email] Ambiguous routing: multiple active projects match key "${projectKey}" for sender "${senderUser.email}"`);
    return {
      success: false,
      accepted: false,
      error: `Inbound email rejected: multiple candidate projects found with key "${projectKey}"`,
    };
  }

  const project = candidateProjects[0];

  // Verify access: sender must have at least MEMBER access (rejects VIEWERs)
  const hasMemberAccess = await verifyProjectAccess(project.id, senderUser.id, "MEMBER");
  if (!hasMemberAccess) {
    console.warn(`[inbound-email] Sender "${senderUser.email}" does not have MEMBER access to project "${project.id}"`);
    return {
      success: false,
      accepted: false,
      error: "Inbound email rejected: project not found or sender unauthorized",
    };
  }

  if (project.columns.length === 0) {
    return {
      success: false,
      accepted: false,
      error: `Project "${project.name}" has no columns to place the new card in`,
    };
  }

  // Derive unique messageId for duplicate delivery prevention.
  // Explicit Message-ID deduplicates permanently per project; fallback hashes only deduplicate
  // within FALLBACK_DEDUPE_WINDOW_MS so recurring emails with identical text are not swallowed.
  const rawMessageId = (payload.messageId || payload.message_id || "").trim();
  const explicitMessageId = rawMessageId
    ? rawMessageId.length > 500
      ? `sha256:${crypto.createHash("sha256").update(rawMessageId).digest("hex")}`
      : rawMessageId
    : null;

  let existingCard: {
    id: string;
    projectId: string;
    number: number;
    title: string;
    columnId: string;
  } | null = null;
  let messageIdToStore: string;

  if (explicitMessageId) {
    existingCard = await db.card.findFirst({
      where: { projectId: project.id, messageId: explicitMessageId },
      select: {
        id: true,
        projectId: true,
        number: true,
        title: true,
        columnId: true,
      },
    });
    messageIdToStore = explicitMessageId;
  } else {
    const contentHash = crypto
      .createHash("sha256")
      .update(`${senderUser.email}:${combinedRecipient}:${payload.subject || ""}:${payload.text || payload.html || ""}`)
      .digest("hex");
    const hashPrefix = `hash:${contentHash}:`;
    const windowStart = new Date(Date.now() - FALLBACK_DEDUPE_WINDOW_MS);

    existingCard = await db.card.findFirst({
      where: {
        projectId: project.id,
        messageId: { startsWith: hashPrefix },
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        number: true,
        title: true,
        columnId: true,
      },
    });
    messageIdToStore = `${hashPrefix}${crypto.randomUUID()}`;
  }

  if (existingCard) {
    return {
      success: true,
      accepted: true,
      duplicate: true,
      card: {
        id: existingCard.id,
        projectId: existingCard.projectId,
        number: existingCard.number,
        title: existingCard.title,
        columnId: existingCard.columnId,
        identifier: `${project.key}-${existingCard.number}`,
      },
    };
  }

  // Select target column: prefer BACKLOG, then UNSTARTED, then non-done, then first column
  const backlogCol =
    project.columns.find((c) => c.group === "BACKLOG") ||
    project.columns.find((c) => c.group === "UNSTARTED") ||
    project.columns.find((c) => !c.isDone) ||
    project.columns[0];

  // Prepare description (strip remote tracking images from both HTML and Markdown text)
  let description: string | null = null;
  if (payload.text && payload.text.trim()) {
    description = stripMarkdownImages(payload.text).trim() || null;
  } else if (payload.html && payload.html.trim()) {
    const boundedHtml = payload.html.slice(0, MAX_EMAIL_BODY_BYTES);
    description = stripMarkdownImages(htmlToMarkdown(boundedHtml, { stripImages: true })).trim() || null;
  }

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    description = description.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  // Derive title, falling back to Untitled Email if blank
  let title = (payload.subject || "").trim();
  if (!title) {
    title = "Untitled Email";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }

  // Delegate card creation directly to cardsService.createCard to enforce validation,
  // card numbering, owner limits, activity recording, and revalidation.
  const createResult = await createCard(
    {
      projectId: project.id,
      columnId: backlogCol.id,
      title,
      description,
      owner: (senderUser.name || senderUser.email).slice(0, 200),
    },
    senderUser.id,
    { messageId: messageIdToStore }
  );

  if (!createResult.success || !createResult.data) {
    return {
      success: false,
      accepted: false,
      error: ("error" in createResult ? createResult.error : undefined) || "Failed to create card",
    };
  }

  const createdCard = createResult.data;

  return {
    success: true,
    accepted: true,
    card: {
      id: createdCard.id,
      projectId: project.id,
      number: createdCard.number,
      title: createdCard.title,
      columnId: createdCard.columnId,
      identifier: `${project.key}-${createdCard.number}`,
    },
  };
}
