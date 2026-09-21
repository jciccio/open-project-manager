"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Flame } from "lucide-react";
import { BurndownPoint, MetricMode } from "@/lib/analytics/types";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  points: BurndownPoint[];
  startRemaining: number;
  currentRemaining: number;
  metricMode: MetricMode;
  isDark: boolean;
}

export default function BurndownChart({
  points,
  startRemaining,
  currentRemaining,
  metricMode,
  isDark,
}: Props) {
  const { t } = useTranslation();

  const textColor = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1";

  const hasData = points.length > 0 && startRemaining > 0;

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.burndownTitle")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("analytics.burndownSubtitle")}
            </p>
          </div>
        </div>
        {hasData && (
          <div className="text-right">
            <span className="text-xs text-slate-400 dark:text-slate-500 block">
              Remaining / Scope
            </span>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {currentRemaining} / {startRemaining}{" "}
              <span className="text-xs font-normal">
                {metricMode === "points" ? "pts" : "cards"}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="h-72 w-full pt-2">
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            <Flame className="h-8 w-8 mb-2 stroke-1 opacity-50" />
            <p>{t("analytics.noDataRange")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" stroke={textColor} fontSize={11} tickLine={false} />
              <YAxis stroke={textColor} fontSize={11} tickLine={false} allowDecimals={false} />
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
              {/* Ideal Burndown Trajectory */}
              <Line
                type="linear"
                dataKey="idealRemaining"
                name={t("analytics.idealBurndown")}
                stroke={isDark ? "#64748b" : "#94a3b8"}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
              {/* Actual Remaining Trajectory */}
              <Line
                type="monotone"
                dataKey="actualRemaining"
                name={t("analytics.actualRemaining")}
                stroke="#6366f1"
                strokeWidth={3}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
