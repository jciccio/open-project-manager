import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, getDatabaseProvider } from "@/lib/db";
import { cleanupTestUser, createTestProject, createTestUser } from "@/test/helpers";

const MIGRATION = "20261117120000_canonical_card_relations";

function migrationStatements(): string[] {
  const dir = getDatabaseProvider() === "postgresql" ? "migrations-postgres" : "migrations";
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma", dir, MIGRATION, "migration.sql"), "utf8");
  return sql
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

describe(`${MIGRATION} migration`, () => {
  let userId: string;
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    userId = (await createTestUser(`canonical-migration-${Date.now()}`)).user.id;
    const project = await createTestProject(userId, "Relation Migration");
    const columnId = (await db.column.create({ data: { projectId: project.id, name: "Todo" } })).id;
    for (const [index, name] of ["A", "B", "C", "D", "E"].entries()) {
      const card = await db.card.create({ data: { projectId: project.id, columnId, title: name, number: index + 1 } });
      ids[name] = card.id;
    }
  });

  afterEach(async () => {
    await cleanupTestUser(userId);
  });

  const ordered = (x: string, y: string) => (ids[x] < ids[y] ? [ids[x], ids[y]] : [ids[y], ids[x]]);

  it("rewrites BLOCKED_BY and reversed RELATES_TO rows into their canonical form", async () => {
    const [acLow, acHigh] = ordered("A", "C");
    const [bdLow, bdHigh] = ordered("B", "D");
    await db.cardRelation.createMany({
      data: [
        { sourceCardId: ids.A, targetCardId: ids.B, type: "BLOCKED_BY" },
        { sourceCardId: ids.C, targetCardId: ids.D, type: "BLOCKED_BY" },
        { sourceCardId: ids.D, targetCardId: ids.C, type: "BLOCKS" },
        { sourceCardId: acHigh, targetCardId: acLow, type: "RELATES_TO" },
        { sourceCardId: bdLow, targetCardId: bdHigh, type: "RELATES_TO" },
        { sourceCardId: bdHigh, targetCardId: bdLow, type: "RELATES_TO" },
        { sourceCardId: ids.E, targetCardId: ids.A, type: "BLOCKS" },
        { sourceCardId: ids.A, targetCardId: ids.E, type: "BLOCKING" },
      ],
    });

    for (const statement of migrationStatements()) await db.$executeRawUnsafe(statement);

    const rows = await db.cardRelation.findMany({
      where: { sourceCard: { project: { userId } } },
      select: { sourceCardId: true, targetCardId: true, type: true },
    });
    const key = (r: { sourceCardId: string; targetCardId: string; type: string }) =>
      `${r.sourceCardId}>${r.targetCardId}:${r.type}`;
    expect(rows.map(key).sort()).toEqual(
      [
        { sourceCardId: ids.B, targetCardId: ids.A, type: "BLOCKS" },
        { sourceCardId: ids.D, targetCardId: ids.C, type: "BLOCKS" },
        { sourceCardId: acLow, targetCardId: acHigh, type: "RELATES_TO" },
        { sourceCardId: bdLow, targetCardId: bdHigh, type: "RELATES_TO" },
        { sourceCardId: ids.E, targetCardId: ids.A, type: "BLOCKS" },
        { sourceCardId: ids.A, targetCardId: ids.E, type: "BLOCKING" },
      ]
        .map(key)
        .sort()
    );
  });
});
