import { describe, it, expect } from "vitest";
import { isSafeUrl, safeHref, SafeUrlSchema } from "@/lib/validation/safeUrl";
import {
  CardCreateSchema,
  CardUpdateSchema,
  CardReorderSchema,
  MAX_CARD_REFERENCE_IDS,
  MAX_REORDER_ITEMS,
  PrioritySchema,
} from "@/lib/validation/cards";
import { FilterJsonSchema } from "@/lib/validation/views";

describe("safeUrl", () => {
  it.each(["https://example.com/a?b=1", "http://example.com", "mailto:a@example.com"])("accepts %s", (url) => {
    expect(isSafeUrl(url)).toBe(true);
    expect(SafeUrlSchema.safeParse(url).success).toBe(true);
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "example.com",
    "",
  ])("rejects %j", (url) => {
    expect(SafeUrlSchema.safeParse(url).success).toBe(false);
    expect(safeHref(url)).toBeUndefined();
  });

  it("rejects overly long URLs", () => {
    expect(SafeUrlSchema.safeParse(`https://example.com/${"a".repeat(3000)}`).success).toBe(false);
  });

  it("returns undefined for null and undefined", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("card schemas", () => {
  const validCreate = { projectId: "p1", columnId: "c1", title: "Fix bug" };

  it("accepts a minimal card and a fully populated one", () => {
    expect(CardCreateSchema.safeParse(validCreate).success).toBe(true);
    expect(
      CardCreateSchema.safeParse({
        ...validCreate,
        priority: "HIGH",
        points: 3,
        dueDate: "2026-12-01",
        description: null,
        labelIds: ["l1"],
      }).success
    ).toBe(true);
  });

  it("rejects an unknown priority", () => {
    expect(PrioritySchema.safeParse("SUPER-URGENT").success).toBe(false);
    expect(CardCreateSchema.safeParse({ ...validCreate, priority: "urgent" }).success).toBe(false);
  });

  it("rejects a non-string or blank title", () => {
    expect(CardCreateSchema.safeParse({ ...validCreate, title: 42 }).success).toBe(false);
    expect(CardCreateSchema.safeParse({ ...validCreate, title: "   " }).success).toBe(false);
    expect(CardCreateSchema.safeParse({ ...validCreate, title: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects string, fractional, NaN and infinite points", () => {
    for (const points of ["3", 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(CardCreateSchema.safeParse({ ...validCreate, points }).success).toBe(false);
    }
  });

  it("rejects an unparseable dueDate", () => {
    expect(CardCreateSchema.safeParse({ ...validCreate, dueDate: "garbage" }).success).toBe(false);
    expect(CardUpdateSchema.safeParse({ dueDate: "garbage" }).success).toBe(false);
    expect(CardUpdateSchema.safeParse({ dueDate: null }).success).toBe(true);
  });

  it("rejects unknown fields on update", () => {
    expect(CardUpdateSchema.safeParse({ title: "ok", projectId: "other" }).success).toBe(false);
  });

  it("rejects an oversized description", () => {
    expect(CardUpdateSchema.safeParse({ description: "x".repeat(50_001) }).success).toBe(false);
  });

  it("validates reorder bodies", () => {
    expect(CardReorderSchema.safeParse({ items: [{ id: "a", order: 0, columnId: "c1" }] }).success).toBe(true);
    expect(CardReorderSchema.safeParse({ items: [] }).success).toBe(false);
    expect(CardReorderSchema.safeParse({ items: [{ id: "a", order: "0" }] }).success).toBe(false);
  });
});

describe("FilterJsonSchema", () => {
  it("accepts a JSON object", () => {
    expect(FilterJsonSchema.safeParse("{}").success).toBe(true);
    expect(FilterJsonSchema.safeParse('{"priority":"HIGH"}').success).toBe(true);
  });

  it.each(["not json", "[]", "null", '"str"', "42"])("rejects %s", (value) => {
    expect(FilterJsonSchema.safeParse(value).success).toBe(false);
  });
});

describe("array size limits", () => {
  const invalidElements = (count: number) => Array.from({ length: count }, (_, i) => i);

  const expectOneIssue = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } }, field: string) => {
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0].path).toEqual([field]);
    expect(result.error?.issues[0].code).toBe("too_big");
  };

  it.each(["labelIds", "assigneeIds"])("rejects an oversized %s before walking its elements", (field) => {
    const base = { projectId: "p", columnId: "c", title: "Card" };
    expectOneIssue(CardCreateSchema.safeParse({ ...base, [field]: invalidElements(MAX_CARD_REFERENCE_IDS + 1) }), field);
    expectOneIssue(CardUpdateSchema.safeParse({ [field]: invalidElements(MAX_CARD_REFERENCE_IDS + 1) }), field);
  });

  it("rejects oversized reorder items before walking them", () => {
    expectOneIssue(CardReorderSchema.safeParse({ items: invalidElements(MAX_REORDER_ITEMS + 1) }), "items");
  });

  it("accepts arrays exactly at each limit", () => {
    const ids = Array.from({ length: MAX_CARD_REFERENCE_IDS }, (_, i) => `id-${i}`);
    expect(CardUpdateSchema.safeParse({ labelIds: ids, assigneeIds: ids }).success).toBe(true);

    const items = Array.from({ length: MAX_REORDER_ITEMS }, (_, i) => ({ id: `id-${i}`, order: i }));
    expect(CardReorderSchema.safeParse({ items }).success).toBe(true);
  });
});
