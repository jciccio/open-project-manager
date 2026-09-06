import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const MAX_ATTEMPTS = 5;

export async function nextCardNumber(projectId: string): Promise<number> {
  const maxCard = await db.card.findFirst({
    where: { projectId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return maxCard ? maxCard.number + 1 : 1;
}

function isCardNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target;
  if (Array.isArray(fields)) return fields.includes("number");
  if (typeof fields === "string") return fields.includes("number");
  return false;
}

/**
 * Retries `create` on a `(projectId, number)` unique-constraint collision by
 * re-reading the current max and trying again, bounded to MAX_ATTEMPTS.
 * `firstAttemptNumber` lets a caller that already tracks its own running
 * counter (e.g. a bulk import) skip the read on the common, non-conflicting
 * path instead of always re-querying up front.
 */
export async function withCardNumberRetry<T>(
  projectId: string,
  firstAttemptNumber: number,
  create: (number: number) => Promise<T>
): Promise<T> {
  let number = firstAttemptNumber;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await create(number);
    } catch (error) {
      if (!isCardNumberConflict(error) || attempt === MAX_ATTEMPTS) throw error;
      number = await nextCardNumber(projectId);
    }
  }
  throw new Error("unreachable");
}
