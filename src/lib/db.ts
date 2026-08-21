import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

export type DatabaseProvider = "sqlite" | "postgresql";

export function getDatabaseProvider(): DatabaseProvider {
  const providerEnv = process.env.DATABASE_PROVIDER?.toLowerCase();
  if (providerEnv === "postgresql" || providerEnv === "postgres") {
    return "postgresql";
  }
  const rawUrl = process.env.DATABASE_URL || "";
  if (rawUrl.startsWith("postgresql://") || rawUrl.startsWith("postgres://")) {
    return "postgresql";
  }
  return "sqlite";
}

export function createPrismaClient(): PrismaClient {
  const provider = getDatabaseProvider();

  if (provider === "postgresql") {
    const connectionString =
      process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/opm";
    const pool = globalForPrisma.pool ?? new Pool({ connectionString });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.pool = pool;
    }
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  }

  const rawUrl = process.env.DATABASE_URL || "file:./dev.db";
  const relativePath = rawUrl.replace(/^file:/, "");
  const dbPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(/*turbopackIgnore: true*/ process.cwd(), relativePath);

  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
