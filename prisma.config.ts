import "dotenv/config";
import { defineConfig } from "prisma/config";

const rawUrl = process.env["DATABASE_URL"] || "";
const isPostgres =
  process.env["DATABASE_PROVIDER"] === "postgresql" ||
  rawUrl.startsWith("postgresql://") ||
  rawUrl.startsWith("postgres://");

export default defineConfig({
  schema: isPostgres ? "prisma/schema.postgresql.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isPostgres ? "prisma/migrations-postgres" : "prisma/migrations",
  },
  datasource: {
    url: rawUrl || (isPostgres ? "postgresql://postgres:postgres@localhost:5432/opm" : "file:./dev.db"),
    // Only meaningful for Postgres — `migrate dev`/`migrate diff` need a real
    // scratch database to apply migration history to and diff against, since
    // (unlike SQLite) Prisma can't reconstruct Postgres schema state offline.
    shadowDatabaseUrl: isPostgres
      ? process.env["SHADOW_DATABASE_URL"] || "postgresql://postgres:postgres@localhost:5432/opm_shadow"
      : undefined,
  },
});
