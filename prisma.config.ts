import "dotenv/config";
import { defineConfig } from "prisma/config";

const rawUrl = process.env["DATABASE_URL"] || "";
const providerEnv = process.env["DATABASE_PROVIDER"]?.toLowerCase();
const isPostgres =
  providerEnv === "postgresql" ||
  providerEnv === "postgres" ||
  rawUrl.startsWith("postgresql://") ||
  rawUrl.startsWith("postgres://");

export default defineConfig({
  schema: isPostgres ? "prisma/schema.postgresql.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isPostgres ? "prisma/migrations-postgres" : "prisma/migrations",
  },
  datasource: {
    url: rawUrl || (isPostgres ? "postgresql://postgres:postgres@localhost:5432/opm" : "file:./dev.db"),
  },
});
