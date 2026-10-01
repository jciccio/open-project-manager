import { describe, it, expect } from "vitest";
import {
  PROJECT_COLORS,
  PRESET_HEX_COLORS,
  DEFAULT_PROJECT_COLOR,
  isPresetColor,
  isHexColor,
  colorNameKey,
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

  it("has an English and a Spanish name for every preset color", () => {
    for (const c of PROJECT_COLORS) {
      const key = colorNameKey(c.name) as keyof typeof en.colorNames;
      expect(en.colorNames[key]).toBe(c.name);
      expect(es.colorNames[key]).toBeTruthy();
    }
  });
});
