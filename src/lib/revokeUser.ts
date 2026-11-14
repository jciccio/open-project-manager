import { db } from "@/lib/db";

export async function revokeUserAccess(identifier: string) {
  const user = await db.user.findFirst({
    where: { OR: [{ id: identifier }, { email: identifier.toLowerCase().trim() }] },
    select: { id: true, email: true },
  });
  if (!user) return null;

  const [updated, deletedTokens, deletedSlackLinks] = await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    }),
    db.apiToken.deleteMany({ where: { userId: user.id } }),
    db.importRecord.deleteMany({
      where: {
        source: "slack",
        entityType: "user",
        OR: [{ userId: user.id }, { localId: user.id }],
      },
    }),
  ]);

  return { email: user.email, tokenVersion: updated.tokenVersion, deletedApiTokens: deletedTokens.count, deletedSlackLinks: deletedSlackLinks.count };
}
