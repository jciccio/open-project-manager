"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { VelocityInterval, MetricMode } from "@/lib/analytics/types";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  intervals: VelocityInterval[];
  metricMode: MetricMode;
  isDark: boolean;
}

export default function VelocityChart({ intervals, metricMode, isDark }: Props) {
  const { t } = useTranslation();

  const textColor = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1";

  const hasData = intervals.some((i) => i.completedPoints > 0 || i.completedCards > 0);

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.velocityTitle")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("analytics.velocitySubtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="h-72 w-full pt-2">
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            <TrendingUp className="h-8 w-8 mb-2 stroke-1 opacity-50" />
            <p>{t("analytics.noDataRange")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={intervals} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
              {metricMode === "points" ? (
                <>
                  <Bar
                    dataKey="completedPoints"
                    name={t("analytics.metricStoryPoints")}
                    fill="#6366f1"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="completedCards"
                    name={t("analytics.metricCards")}
                    fill="#a855f7"
                    radius={[6, 6, 0, 0]}
                  />
                </>
              ) : (
                <Bar
                  dataKey="completedCards"
                  name={t("analytics.metricCards")}
                  fill="#6366f1"
                  radius={[6, 6, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
