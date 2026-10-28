import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const LABEL_EXISTS_ERROR = "A label with this name already exists";

export class LabelExistsError extends Error {
  constructor() {
    super(LABEL_EXISTS_ERROR);
  }
}

interface ScopedLabelInput {
  name: string;
  color: string;
  projectId: string | null;
  userId: string | null;
}

// `@@unique([name, projectId, userId])` never fires: a label always has a NULL
// projectId or userId, and NULLs are distinct in SQLite and Postgres. Prisma
// can't express a partial unique index, so the check lives here.
export async function createScopedLabel(input: ScopedLabelInput) {
  const name = input.name.trim();
  try {
    return await db.$transaction(
      async (tx) => {
        const existing = await tx.label.findFirst({
          where: { name, projectId: input.projectId, userId: input.userId },
          select: { id: true },
        });
        if (existing) throw new LabelExistsError();
        return tx.label.create({
          data: { name, color: input.color, projectId: input.projectId, userId: input.userId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    // P2034 is a Postgres serialization conflict; the transaction only read the
    // duplicate lookup, so a concurrent writer created the same label.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new LabelExistsError();
    }
    throw error;
  }
}
