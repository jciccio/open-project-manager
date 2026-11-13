import { describe, it, expect, afterEach } from "vitest";
import { cardTextSearch } from "../cardSearch";

describe("cardTextSearch", () => {
  const originalProvider = process.env.DATABASE_PROVIDER;
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = originalProvider;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it("matches title or description case-insensitively with literal wildcards on Postgres", () => {
    process.env.DATABASE_PROVIDER = "postgresql";
    const filter = { contains: "100\\% a\\_b c\\\\d", mode: "insensitive" };

    expect(cardTextSearch("100% a_b c\\d")).toEqual([{ title: filter }, { description: filter }]);
  });

  it("uses a plain contains filter on SQLite, which rejects `mode`", () => {
    process.env.DATABASE_PROVIDER = "sqlite";
    process.env.DATABASE_URL = "file:./dev.db";

    expect(cardTextSearch("Login")).toEqual([
      { title: { contains: "Login" } },
      { description: { contains: "Login" } },
    ]);
  });
});
