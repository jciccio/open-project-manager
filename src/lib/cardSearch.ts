import { getDatabaseProvider } from "@/lib/db";

// SQLite LIKE already ignores ASCII case, but Prisma's SQLite connector rejects
// `mode` and emits no ESCAPE clause, so `%` and `_` stay wildcards there.
function containsText(text: string) {
  if (getDatabaseProvider() === "postgresql") {
    return { contains: text.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" };
  }
  return { contains: text };
}

export function cardTextSearch(query: string) {
  const filter = containsText(query);
  return [{ title: filter }, { description: filter }];
}
