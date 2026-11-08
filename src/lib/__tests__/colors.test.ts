import { describe, it, expect } from "vitest";
import {
  PROJECT_COLORS,
  PRESET_HEX_COLORS,
  DEFAULT_PROJECT_COLOR,
  isPresetColor,
  isHexColor,
  assertHexColor,
  INVALID_COLOR_ERROR,
  colorNameKey,
  relativeLuminance,
  contrastRatio,
  chipTextColor,
} from "../colors";
import { en } from "@/locales/en";
import { es } from "@/locales/es";

describe("colors module", () => {
  it("exports a rich palette of at least 20 curated colors", () => {
    expect(PROJECT_COLORS.length).toBeGreaterThanOrEqual(20);
    expect(PROJECT_COLORS.length).toBe(PRESET_HEX_COLORS.length);
  });

  it("has valid hex color values and unique names", () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    const names = new Set<string>();
    const values = new Set<string>();

    for (const color of PROJECT_COLORS) {
      expect(color.value).toMatch(hexRegex);
      expect(names.has(color.name)).toBe(false);
      expect(values.has(color.value)).toBe(false);
      names.add(color.name);
      values.add(color.value);
    }
  });

  it("checks preset colors correctly with isPresetColor", () => {
    expect(isPresetColor(DEFAULT_PROJECT_COLOR)).toBe(true);
    expect(isPresetColor("#6366f1")).toBe(true);
    expect(isPresetColor("#6366F1")).toBe(true);
    expect(isPresetColor("#123456")).toBe(false);
  });

  it("accepts only #rgb and #rrggbb hex colors", () => {
    for (const ok of ["#fff", "#6366f1", "#ABCDEF", ...PRESET_HEX_COLORS]) expect(isHexColor(ok)).toBe(true);
    for (const bad of ["", "red", "#12345", "#1234567", "6366f1", "#gggggg", "#fff;background:url(x)"]) {
      expect(isHexColor(bad)).toBe(false);
    }
  });

  it("asserts valid hex colors or throws INVALID_COLOR_ERROR", () => {
    expect(assertHexColor("#6366f1")).toBe("#6366f1");
    expect(assertHexColor("#fff")).toBe("#fff");
    expect(() => assertHexColor("invalid")).toThrow(INVALID_COLOR_ERROR);
    expect(() => assertHexColor("#12345")).toThrow(INVALID_COLOR_ERROR);
  });

  it("converts color names to camelCase keys with colorNameKey", () => {
    expect(colorNameKey("Teal")).toBe("teal");
    expect(colorNameKey("Deep Violet")).toBe("deepViolet");
    expect(colorNameKey("Dark Emerald")).toBe("darkEmerald");
  });

  it("has an English and a Spanish name for every preset color", () => {
    for (const c of PROJECT_COLORS) {
      const key = colorNameKey(c.name) as keyof typeof en.colorNames;
      expect(en.colorNames[key]).toBe(c.name);
      expect(es.colorNames[key]).toBeTruthy();
    }
  });

  describe("chipTextColor and contrast", () => {
    it("guarantees at least 4.5:1 contrast against every preset in PROJECT_COLORS (WCAG 1.4.3 AA)", () => {
      const lWhite = relativeLuminance("#ffffff");
      const lDark = relativeLuminance("#020617");

      for (const { value, name } of PROJECT_COLORS) {
        const textClass = chipTextColor(value);
        expect(textClass === "text-white" || textClass === "text-slate-950").toBe(true);

        const lBg = relativeLuminance(value);
        const ratio = textClass === "text-white" ? contrastRatio(lWhite, lBg) : contrastRatio(lBg, lDark);
        expect(ratio, `Color ${name} (${value}) with ${textClass} must have >= 4.5:1 contrast`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("selects dark text for seeded/light colors that fail contrast with white", () => {
      // Previously failed with white text:
      // #10b981 (2.54), #ec4899 (3.53), #3b82f6 (3.68), #ef4444 (3.76), #8b5cf6 (4.23), #6366f1 (4.47)
      expect(chipTextColor("#10b981")).toBe("text-slate-950");
      expect(chipTextColor("#ec4899")).toBe("text-slate-950");
      expect(chipTextColor("#3b82f6")).toBe("text-slate-950");
      expect(chipTextColor("#ef4444")).toBe("text-slate-950");
      expect(chipTextColor("#8b5cf6")).toBe("text-slate-950");
      expect(chipTextColor("#6366f1")).toBe("text-slate-950");
    });

    it("selects white text for deep/dark colors that pass contrast with white", () => {
      expect(chipTextColor("#1d4ed8")).toBe("text-white");
      expect(chipTextColor("#7c3aed")).toBe("text-white");
      expect(chipTextColor("#047857")).toBe("text-white");
    });
  });
});
