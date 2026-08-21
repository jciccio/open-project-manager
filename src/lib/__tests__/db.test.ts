import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDatabaseProvider, createPrismaClient } from "../db";

describe("Database Provider & Client Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getDatabaseProvider()", () => {
    it("defaults to sqlite when no database env variables are set", () => {
      delete process.env.DATABASE_PROVIDER;
      delete process.env.DATABASE_URL;
      expect(getDatabaseProvider()).toBe("sqlite");
    });

    it("returns sqlite when DATABASE_URL is a file URI", () => {
      delete process.env.DATABASE_PROVIDER;
      process.env.DATABASE_URL = "file:./dev.db";
      expect(getDatabaseProvider()).toBe("sqlite");
    });

    it("returns postgresql when DATABASE_PROVIDER is 'postgresql'", () => {
      process.env.DATABASE_PROVIDER = "postgresql";
      delete process.env.DATABASE_URL;
      expect(getDatabaseProvider()).toBe("postgresql");
    });

    it("returns postgresql when DATABASE_PROVIDER is 'postgres' (case-insensitive)", () => {
      process.env.DATABASE_PROVIDER = "POSTGRES";
      delete process.env.DATABASE_URL;
      expect(getDatabaseProvider()).toBe("postgresql");
    });

    it("returns postgresql when DATABASE_URL starts with postgresql://", () => {
      delete process.env.DATABASE_PROVIDER;
      process.env.DATABASE_URL = "postgresql://user:secret@localhost:5432/mydb";
      expect(getDatabaseProvider()).toBe("postgresql");
    });

    it("returns postgresql when DATABASE_URL starts with postgres://", () => {
      delete process.env.DATABASE_PROVIDER;
      process.env.DATABASE_URL = "postgres://user:secret@localhost:5432/mydb";
      expect(getDatabaseProvider()).toBe("postgresql");
    });
  });

  describe("createPrismaClient()", () => {
    it("instantiates PrismaClient with SQLite adapter by default", () => {
      delete process.env.DATABASE_PROVIDER;
      delete process.env.DATABASE_URL;
      const client = createPrismaClient();
      expect(client).toBeDefined();
      expect(typeof client.$connect).toBe("function");
      expect(typeof client.user.findMany).toBe("function");
    });
  });
});
