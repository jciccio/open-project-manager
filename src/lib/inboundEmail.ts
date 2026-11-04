import { db } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/import/htmlToMarkdown";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/validation/cards";

export interface InboundEmailPayload {
  to: string;
  from: string;
  subject?: string;
  text?: string;
  html?: string;
  spf?: string;
  dkim?: string;
}

export interface InboundEmailResult {
  success: boolean;
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

/**
 * Extracts a project key from a recipient address or list of addresses.
 * Examples:
 *   "opm+BACKLOG@opm.local" -> "BACKLOG"
 *   "task+PROJ@example.com" -> "PROJ"
 *   "PROJ@inbound.opm.local" -> "PROJ"
 *   "Project Board <opm+TEST@domain.com>" -> "TEST"
 *   "alice@x.com, opm+BETA@y.com" -> "BETA"
 *   "bob+news@gmail.com, opm+PROJ@inbound.example.com" -> "PROJ"
 *   "\"Smith, John\" <PROJ@inbound.example.com>" -> "PROJ"
 */
export function extractProjectKeyFromRecipient(recipient: string): string | null {
  if (!recipient || typeof recipient !== "string") return null;

  const noComments = stripComments(recipient);
  if (!noComments) return null;

  const mailboxes = splitMailboxes(noComments);
  if (!mailboxes || mailboxes.length === 0) return null;

  const parsedAddresses: { localPart: string; domain: string }[] = [];
  for (const mb of mailboxes) {
    const parsed = parseMailboxAddress(mb);
    if (parsed) {
      const atIdx = parsed.lastIndexOf("@");
      parsedAddresses.push({
        localPart: parsed.slice(0, atIdx),
        domain: parsed.slice(atIdx + 1),
      });
    } else {
      const raw = mb.trim();
      if (/^[A-Za-z0-9_-]+$/.test(raw)) {
        parsedAddresses.push({ localPart: raw, domain: "" });
      }
    }
  }

  if (parsedAddresses.length === 0) return null;

  const configuredDomain = (process.env.INBOUND_EMAIL_DOMAIN || "").toLowerCase().trim();

  // 1. Check for standard opm+KEY or task+KEY prefix
  for (const addr of parsedAddresses) {
    const plusIdx = addr.localPart.indexOf("+");
    if (plusIdx !== -1) {
      const prefix = addr.localPart.slice(0, plusIdx).toLowerCase();
      const key = addr.localPart.slice(plusIdx + 1).trim();
      if ((prefix === "opm" || prefix === "task") && /^[A-Za-z0-9_-]+$/.test(key)) {
        return key.toUpperCase();
      }
    }
  }

  // 2. If configuredDomain is set, look for addresses matching configuredDomain
  if (configuredDomain) {
    for (const addr of parsedAddresses) {
      if (addr.domain === configuredDomain) {
        const plusIdx = addr.localPart.indexOf("+");
        const key = plusIdx !== -1 ? addr.localPart.slice(plusIdx + 1).trim() : addr.localPart;
        if (/^[A-Za-z0-9_-]+$/.test(key)) {
          return key.toUpperCase();
        }
      }
    }
  }

  // 3. Look for any inbound / opm subdomain address (e.g. KEY@inbound.domain.com or opm+KEY@domain)
  for (const addr of parsedAddresses) {
    if (addr.domain.startsWith("inbound.") || addr.domain.includes(".inbound.") || addr.domain.includes("opm")) {
      const plusIdx = addr.localPart.indexOf("+");
      const key = plusIdx !== -1 ? addr.localPart.slice(plusIdx + 1).trim() : addr.localPart;
      if (/^[A-Za-z0-9_-]+$/.test(key)) {
        return key.toUpperCase();
      }
    }
  }

  // 4. Any other plus-addressed mailbox
  for (const addr of parsedAddresses) {
    const plusIdx = addr.localPart.indexOf("+");
    if (plusIdx !== -1) {
      const key = addr.localPart.slice(plusIdx + 1).trim();
      if (/^[A-Za-z0-9_-]+$/.test(key)) {
        return key.toUpperCase();
      }
    }
  }

  // 5. Fallback: first address localPart if alphanumeric
  const first = parsedAddresses[0];
  if (/^[A-Za-z0-9_-]+$/.test(first.localPart)) {
    return first.localPart.toUpperCase();
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

export async function processInboundEmail(
  payload: InboundEmailPayload
): Promise<InboundEmailResult> {
  const projectKey = extractProjectKeyFromRecipient(payload.to);
  if (!projectKey) {
    return {
      success: false,
      error: `Could not extract project key from recipient address: "${payload.to}"`,
    };
  }

  const senderEmail = extractSenderEmail(payload.from);
  if (!senderEmail) {
    return {
      success: false,
      error: `Invalid or missing sender email address in from: "${payload.from}"`,
    };
  }

  // Look up registered sender
  const senderUser = await db.user.findUnique({
    where: { email: senderEmail },
  });

  if (!senderUser) {
    console.warn(`[inbound-email] Sender "${senderEmail}" is not a registered user`);
    return {
      success: false,
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
    console.warn(`[inbound-email] No project with key "${projectKey}" found accessible by sender "${senderEmail}"`);
    return {
      success: false,
      error: "Inbound email rejected: project not found or sender unauthorized",
    };
  }

  if (candidateProjects.length > 1) {
    console.warn(`[inbound-email] Ambiguous routing: multiple active projects match key "${projectKey}" for sender "${senderEmail}"`);
    return {
      success: false,
      error: `Inbound email rejected: multiple candidate projects found with key "${projectKey}"`,
    };
  }

  const project = candidateProjects[0];

  // Verify access: sender must have at least MEMBER access (rejects VIEWERs)
  const hasMemberAccess = await verifyProjectAccess(project.id, senderUser.id, "MEMBER");
  if (!hasMemberAccess) {
    console.warn(`[inbound-email] Sender "${senderEmail}" does not have MEMBER access to project "${project.id}"`);
    return {
      success: false,
      error: "Inbound email rejected: project not found or sender unauthorized",
    };
  }

  if (project.columns.length === 0) {
    return {
      success: false,
      error: `Project "${project.name}" has no columns to place the new card in`,
    };
  }

  // Select target column: prefer BACKLOG, then UNSTARTED, then non-done, then first column
  const backlogCol =
    project.columns.find((c) => c.group === "BACKLOG") ||
    project.columns.find((c) => c.group === "UNSTARTED") ||
    project.columns.find((c) => !c.isDone) ||
    project.columns[0];

  // Prepare description
  let description: string | null = null;
  if (payload.text && payload.text.trim()) {
    description = payload.text.trim();
  } else if (payload.html && payload.html.trim()) {
    description = htmlToMarkdown(payload.html).trim() || null;
  }

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    description = description.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  // Order for new card
  const lastCard = await db.card.findFirst({
    where: { columnId: backlogCol.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (lastCard?.order ?? 0) + 10000;

  // Determine starting card number based on current maximum in project
  const maxCard = await db.card.findFirst({
    where: { projectId: project.id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const startingNumber = (maxCard?.number ?? 0) + 1;

  // Derive title, falling back to Untitled Email if blank
  let title = (payload.subject || "").trim();
  if (!title) {
    title = "Untitled Email";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }

  const completedAt = backlogCol.isDone ? new Date() : null;

  // Create card with sequence number
  const createdCard = await withCardNumberRetry(project.id, startingNumber, async (cardNumber) => {
    return db.$transaction(async (tx) => {
      const card = await tx.card.create({
        data: {
          projectId: project.id,
          columnId: backlogCol.id,
          title,
          description,
          number: cardNumber,
          order,
          owner: senderUser.name || senderUser.email,
          completedAt,
        },
      });

      const activity: ActivityEntry[] = [
        {
          cardId: card.id,
          actorUserId: senderUser.id,
          type: "card_created",
          toValue: title,
        },
      ];
      await createActivities(tx, activity);

      return { card, activity };
    });
  });

  notifyActivity(project.id, createdCard.activity);
  safeRevalidatePath(`/projects/${project.id}`);

  return {
    success: true,
    card: {
      id: createdCard.card.id,
      projectId: project.id,
      number: createdCard.card.number,
      title: createdCard.card.title,
      columnId: createdCard.card.columnId,
      identifier: `${project.key}-${createdCard.card.number}`,
    },
  };
}
