import { db } from "../src/lib/db";

export async function resolveImportUserId(identifier?: string): Promise<string> {
  if (identifier) {
    const user = await db.user.findFirst({
      where: { OR: [{ id: identifier }, { email: identifier }] },
      select: { id: true, email: true },
    });
    if (!user) throw new Error(`No user matches "${identifier}" (pass an email or a user id)`);
    console.log(`Importing as ${user.email}`);
    return user.id;
  }

  const users = await db.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length === 0) throw new Error("This instance has no users. Create one in the web UI first");
  if (users.length > 1) {
    throw new Error("More than one user on this instance. Say which one owns the import with --user <email>");
  }
  console.log(`Importing as ${users[0].email}`);
  return users[0].id;
}
