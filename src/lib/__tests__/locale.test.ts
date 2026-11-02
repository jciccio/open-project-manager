import { describe, it, expect } from "vitest";
import { localeFromAcceptLanguage, resolveLocale } from "@/lib/locale";
import { formatDate, formatDueDate } from "@/lib/formatDate";

describe("resolveLocale", () => {
  it("prefers a valid cookie over Accept-Language", () => {
    expect(resolveLocale("en", "es-ES,es;q=0.9")).toEqual({ locale: "en", fromCookie: true });
  });

  it("falls back to Accept-Language, then English, when the cookie is missing or invalid", () => {
    expect(resolveLocale(undefined, "es-MX,es;q=0.9,en;q=0.8")).toEqual({ locale: "es", fromCookie: false });
    expect(resolveLocale("fr", "es")).toEqual({ locale: "es", fromCookie: false });
    expect(resolveLocale(undefined, undefined)).toEqual({ locale: "en", fromCookie: false });
  });
});

describe("localeFromAcceptLanguage", () => {
  it("ranks by q-value, not by position", () => {
    expect(localeFromAcceptLanguage("en;q=0.5, es;q=0.9")).toBe("es");
  });

  it("skips unsupported and q=0 languages", () => {
    expect(localeFromAcceptLanguage("fr-FR, de;q=0.9, es;q=0.1")).toBe("es");
    expect(localeFromAcceptLanguage("es;q=0, en;q=0.2")).toBe("en");
    expect(localeFromAcceptLanguage("fr, de")).toBeNull();
  });
});

describe("date formatting", () => {
  it("formats a due date as its UTC calendar day in the app locale", () => {
    const due = "2026-10-28T00:00:00.000Z";
    expect(formatDueDate(due, "en", { month: "short", day: "numeric" })).toBe("Oct 28");
    expect(formatDueDate(due, "es", { month: "short", day: "numeric" })).toBe("28 oct");
    expect(formatDueDate(due, "en", { month: "short", day: "numeric", timeZone: "America/Chicago" })).toBe("Oct 28");
  });

  it("formats timestamps in the app locale rather than the runtime default", () => {
    const at = "2026-03-05T12:00:00.000Z";
    expect(formatDate(at, "es", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" })).toBe("5/3/2026");
    expect(formatDate(at, "en", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" })).toBe("3/5/2026");
  });
});
