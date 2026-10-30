import { db } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/import/htmlToMarkdown";
import { withCardNumberRetry } from "@/lib/cardNumbering";
import { createActivities, notifyActivity, type ActivityEntry } from "@/lib/services/activity";
import { safeRevalidatePath } from "@/lib/revalidate";

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
 * Extracts a project key from a recipient address.
 * Examples:
 *   "opm+BACKLOG@opm.local" -> "BACKLOG"
 *   "task+PROJ@example.com" -> "PROJ"
 *   "PROJ@inbound.opm.local" -> "PROJ"
 *   "Project Board <opm+TEST@domain.com>" -> "TEST"
 */
export function extractProjectKeyFromRecipient(recipient: string): string | null {
  if (!recipient || typeof recipient !== "string") return null;

  const angleMatch = recipient.match(/<([^>]+)>/);
  const rawEmail = angleMatch ? angleMatch[1] : recipient;
  const localPart = rawEmail.split("@")[0]?.trim();
  if (!localPart) return null;

  const plusIndex = localPart.indexOf("+");
  if (plusIndex !== -1) {
    const key = localPart.slice(plusIndex + 1).trim();
    return key ? key.toUpperCase() : null;
  }

  return localPart.toUpperCase();
}

/**
 * Extracts clean email address from sender string: "Alice <alice@example.com>" -> "alice@example.com".
 */
export function extractSenderEmail(sender: string): string | null {
  if (!sender || typeof sender !== "string") return null;
  const match = sender.match(/<([^>]+)>/);
  const email = (match ? match[1] : sender).trim().toLowerCase();
  return email || null;
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

  // Look up project
  const project = await db.project.findFirst({
    where: { key: projectKey },
    include: {
      columns: {
        orderBy: { order: "asc" },
      },
      members: {
        include: { user: true },
      },
      user: true,
    },
  });

  if (!project) {
    return {
      success: false,
      error: `Project with key "${projectKey}" not found`,
    };
  }

  // Check sender authorization: sender must be project owner or member
  const senderUser = await db.user.findUnique({
    where: { email: senderEmail },
  });

  if (!senderUser) {
    return {
      success: false,
      error: `Sender "${senderEmail}" is not a registered user. Inbound emails from non-members are rejected.`,
    };
  }

  const isOwner = project.userId === senderUser.id;
  const isMember = project.members.some((m) => m.userId === senderUser.id);

  if (!isOwner && !isMember) {
    return {
      success: false,
      error: `Sender "${senderEmail}" is not a member of project "${project.name}" (${projectKey}). Inbound email rejected.`,
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

  // Order for new card
  const lastCard = await db.card.findFirst({
    where: { columnId: backlogCol.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (lastCard?.order ?? 0) + 10000;

  // Create card with number
  const title = payload.subject.trim();
  const createdCard = await withCardNumberRetry(project.id, 1, async (cardNumber) => {
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
