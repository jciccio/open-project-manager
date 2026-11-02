import { db } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/import/htmlToMarkdown";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { safeRevalidatePath } from "@/lib/revalidate";
import { verifyProjectAccess } from "@/lib/permissions";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/validation/cards";

export interface InboundEmailPayload {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
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
 * Extracts a project key from a recipient address or list of addresses.
 * Examples:
 *   "opm+BACKLOG@opm.local" -> "BACKLOG"
 *   "task+PROJ@example.com" -> "PROJ"
 *   "PROJ@inbound.opm.local" -> "PROJ"
 *   "Project Board <opm+TEST@domain.com>" -> "TEST"
 *   "alice@x.com, opm+KEY@y.com" -> "KEY"
 */
export function extractProjectKeyFromRecipient(recipient: string): string | null {
  if (!recipient || typeof recipient !== "string") return null;

  const addresses = recipient.split(",").map((a) => a.trim()).filter(Boolean);
  if (addresses.length === 0) return null;

  // First check if any address has a plus-addressed project key (e.g. opm+KEY@domain)
  for (const addr of addresses) {
    const angleMatch = addr.match(/<([^>]+)>/);
    const rawEmail = angleMatch ? angleMatch[1] : addr;
    const localPart = rawEmail.split("@")[0]?.trim();
    if (!localPart) continue;

    const plusIndex = localPart.indexOf("+");
    if (plusIndex !== -1) {
      const key = localPart.slice(plusIndex + 1).trim();
      if (key) return key.toUpperCase();
    }
  }

  // Fallback to the first address's localPart if direct address (KEY@inbound.domain)
  const firstAddr = addresses[0];
  const angleMatch = firstAddr.match(/<([^>]+)>/);
  const rawEmail = angleMatch ? angleMatch[1] : firstAddr;
  const localPart = rawEmail.split("@")[0]?.trim();
  if (localPart && /^[A-Za-z0-9_-]+$/.test(localPart)) {
    return localPart.toUpperCase();
  }

  return null;
}

/**
 * Extracts clean email address from sender RFC 5322 string.
 * Uses the actual address enclosed in the trailing angle brackets to prevent display-name injection
 * (e.g. `"<owner@corp.com>" <attacker@evil.com>` -> `"attacker@evil.com"`).
 */
export function extractSenderEmail(sender: string): string | null {
  if (!sender || typeof sender !== "string") return null;

  const angleMatches = [...sender.matchAll(/<([^>]+)>/g)];
  const rawEmail = angleMatches.length > 0 ? angleMatches[angleMatches.length - 1][1] : sender;
  const email = rawEmail.trim().toLowerCase();

  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) ? email : null;
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

  if (!payload.subject || !payload.subject.trim()) {
    return {
      success: false,
      error: "Email subject is required to create card title",
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

  // Look up candidate projects matching key where sender is owner or active member
  const candidateProjects = await db.project.findMany({
    where: {
      key: projectKey,
      isArchived: false,
      OR: [
        { userId: senderUser.id },
        { members: { some: { userId: senderUser.id, role: { in: ["OWNER", "MEMBER"] } } } },
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

  // Select target column: prefer BACKLOG, then UNSTARTED, then first column
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

  // Create card with sequence number
  const title = payload.subject.trim();
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
