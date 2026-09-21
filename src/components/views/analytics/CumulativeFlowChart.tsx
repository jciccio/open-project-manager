"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Layers } from "lucide-react";
import { CumulativeFlowPoint, MetricMode } from "@/lib/analytics/types";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  points: CumulativeFlowPoint[];
  columns: Array<{ id: string; name: string; isDone: boolean }>;
  metricMode: MetricMode;
  isDark: boolean;
}

const PALETTE = [
  "#64748b", // slate
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
  "#14b8a6", // teal
  "#06b6d4", // cyan
];

export default function CumulativeFlowChart({
  points,
  columns,
  metricMode,
  isDark,
}: Props) {
  const { t } = useTranslation();

  const textColor = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1";

  const hasData = points.length > 0 && columns.length > 0;

  // Determine colors: done column is emerald, others cycled from palette
  let nonDoneIdx = 0;
  const columnColors: Record<string, string> = {};
  columns.forEach((col) => {
    if (col.isDone || col.name.toLowerCase().includes("done")) {
      columnColors[col.name] = "#10b981"; // emerald
    } else {
      columnColors[col.name] = PALETTE[nonDoneIdx % PALETTE.length];
      nonDoneIdx++;
    }
  });

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.cumulativeFlowTitle")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("analytics.cumulativeFlowSubtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="h-72 w-full pt-2">
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            <Layers className="h-8 w-8 mb-2 stroke-1 opacity-50" />
            <p>{t("analytics.noDataRange")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" stroke={textColor} fontSize={11} tickLine={false} />
              <YAxis
                stroke={textColor}
                fontSize={11}
                tickLine={false}
                allowDecimals={false}
                label={{
                  value: metricMode === "points" ? "Points" : "Cards",
                  angle: -90,
                  position: "insideLeft",
                  offset: 25,
                  fill: textColor,
                  fontSize: 10,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: tooltipBg,
                  borderColor: tooltipBorder,
                  borderRadius: "12px",
                  color: isDark ? "#fff" : "#0f172a",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                }}
              />
              <Legend
                formatter={(val) => (
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {val}
                  </span>
                )}
              />
              {/* Stacked Areas in Column Workflow Order */}
              {columns.map((col) => {
                const color = columnColors[col.name] || "#6366f1";
                return (
                  <Area
                    key={col.id}
                    type="monotone"
                    dataKey={col.name}
                    stackId="1"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.65}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
