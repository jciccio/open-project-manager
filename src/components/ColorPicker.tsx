"use client";

import { useRef } from "react";
import { Check, Pipette } from "lucide-react";
import { PROJECT_COLORS, ColorOption, isPresetColor } from "@/lib/colors";
import { useTranslation } from "./LanguageProvider";

interface Props {
  value: string;
  onChange: (color: string) => void;
  colors?: ColorOption[];
  label?: string;
  showCustomPicker?: boolean;
  size?: "sm" | "md";
}

export default function ColorPicker({
  value,
  onChange,
  colors = PROJECT_COLORS,
  label,
  showCustomPicker = true,
  size = "md",
}: Props) {
  const customInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const isCustom = !isPresetColor(value);

  const swatchSizeClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            {label}
          </label>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full border border-slate-300 dark:border-slate-700"
              style={{ backgroundColor: value }}
            />
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase">
              {value}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800">
        {colors.map((c) => {
          const isSelected = value.toLowerCase() === c.value.toLowerCase();
          return (
            <button
              type="button"
              key={c.value}
              onClick={() => onChange(c.value)}
              title={c.name}
              aria-label={c.name}
              className={`relative ${swatchSizeClass} rounded-full transition-all duration-150 flex items-center justify-center ${
                isSelected
                  ? "ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900 scale-110 shadow-sm"
                  : "opacity-85 hover:opacity-100 hover:scale-105"
              }`}
              style={{ backgroundColor: c.value }}
            >
              {isSelected && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
              )}
            </button>
          );
        })}

        {showCustomPicker && (
          <div className="relative">
            <button
              type="button"
              onClick={() => customInputRef.current?.click()}
              title={t("newProjectModal.customColor") || "Custom Color"}
              aria-label={t("newProjectModal.customColor") || "Custom Color"}
              className={`relative ${swatchSizeClass} rounded-full border-2 border-dashed transition-all duration-150 flex items-center justify-center overflow-hidden ${
                isCustom
                  ? "border-indigo-500 ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900 scale-110 shadow-sm"
                  : "border-slate-300 dark:border-slate-700 hover:border-indigo-400 opacity-85 hover:opacity-100 hover:scale-105"
              }`}
              style={{
                backgroundColor: isCustom ? value : "transparent",
              }}
            >
              {isCustom ? (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
              ) : (
                <Pipette className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              )}
            </button>
            <input
              ref={customInputRef}
              type="color"
              value={value.startsWith("#") ? value : "#6366f1"}
              onChange={(e) => onChange(e.target.value)}
              className="sr-only"
              tabIndex={-1}
            />
          </div>
        )}
      </div>
    </div>
  );
}
