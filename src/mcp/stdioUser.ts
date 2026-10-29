import { db } from "@/lib/db";

export async function resolveStdioUser(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  return db.user.findFirst({
    where: { OR: [{ id: trimmed }, { email: trimmed.toLowerCase() }] },
    select: { id: true, email: true },
  });
}
