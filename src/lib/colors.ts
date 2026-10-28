export interface ColorOption {
  name: string;
  value: string;
}

export const PROJECT_COLORS: ColorOption[] = [
  { name: "Indigo", value: "#6366f1" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Emerald", value: "#10b981" },
  { name: "Green", value: "#22c55e" },
  { name: "Lime", value: "#84cc16" },
  { name: "Yellow", value: "#eab308" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Orange", value: "#f97316" },
  { name: "Rust", value: "#ea580c" },
  { name: "Red", value: "#ef4444" },
  { name: "Ruby", value: "#e11d48" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Pink", value: "#ec4899" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Purple", value: "#a855f7" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Deep Violet", value: "#7c3aed" },
  { name: "Deep Navy", value: "#1d4ed8" },
  { name: "Dark Emerald", value: "#047857" },
  { name: "Slate", value: "#64748b" },
  { name: "Zinc", value: "#71717a" },
];

export const PRESET_HEX_COLORS = PROJECT_COLORS.map((c) => c.value);

export const DEFAULT_PROJECT_COLOR = "#6366f1";

export function isPresetColor(color: string): boolean {
  return PRESET_HEX_COLORS.some((c) => c.toLowerCase() === color.toLowerCase());
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const INVALID_COLOR_ERROR = "Color must be a hex value like #6366f1";

export function isHexColor(color: string): boolean {
  return HEX_COLOR_PATTERN.test(color);
}

export function assertHexColor(color: string): string {
  if (!isHexColor(color)) throw new Error(INVALID_COLOR_ERROR);
  return color;
}

export function colorNameKey(name: string): string {
  return name
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join("");
}
