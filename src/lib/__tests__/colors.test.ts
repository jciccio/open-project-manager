import { describe, it, expect } from "vitest";
import {
  PROJECT_COLORS,
  PRESET_HEX_COLORS,
  DEFAULT_PROJECT_COLOR,
  isPresetColor,
} from "../colors";

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
});
