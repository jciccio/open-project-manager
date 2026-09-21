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
import { Timer, Clock, ArrowRight } from "lucide-react";
import { CycleTimeSummary } from "@/lib/analytics/types";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  summary: CycleTimeSummary;
  isDark: boolean;
}

export default function CycleTimeChart({ summary, isDark }: Props) {
  const { t } = useTranslation();

  const textColor = isDark ? "#94a3b8" : "#475569";
  const gridColor = isDark ? "#1e293b" : "#f1f5f9";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1";

  // Take up to 15 most recent completed cards for the individual chart
  const recentRecords = summary.records.slice(-15).map((r) => ({
    name: `#${r.cardNumber}`,
    title: r.title,
    leadTime: r.leadTimeDays,
    cycleTime: r.cycleTimeDays,
  }));

  const hasData = summary.records.length > 0;

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Timer className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.cycleTimeTitle")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("analytics.cycleTimeSubtitle")}
            </p>
          </div>
        </div>

        {/* Mini stats pills */}
        {hasData && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs">
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">{t("analytics.avgCycleTime")}:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {summary.avgCycleTimeDays} {t("analytics.days")}
              </span>
            </div>
            <div className="px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs">
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">{t("analytics.avgLeadTime")}:</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {summary.avgLeadTimeDays} {t("analytics.days")}
              </span>
            </div>
            <div className="px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs">
              <span className="text-slate-500 dark:text-slate-400 mr-1.5">{t("analytics.medianCycleTime")}:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {summary.medianCycleTimeDays} {t("analytics.days")}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="h-72 w-full pt-2">
        {!hasData ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            <Clock className="h-8 w-8 mb-2 stroke-1 opacity-50" />
            <p>{t("analytics.noDataRange")}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={recentRecords} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="name" stroke={textColor} fontSize={11} tickLine={false} />
              <YAxis
                stroke={textColor}
                fontSize={11}
                tickLine={false}
                label={{
                  value: t("analytics.days"),
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
                formatter={(val: any, name: any) => [`${val} ${t("analytics.days")}`, name]}
                labelFormatter={(_, items) => {
                  if (items && items[0]?.payload?.title) {
                    return `${items[0].payload.name}: ${items[0].payload.title}`;
                  }
                  return "";
                }}
              />
              <Legend
                formatter={(val) => (
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {val}
                  </span>
                )}
              />
              <Bar
                dataKey="cycleTime"
                name={t("analytics.avgCycleTime")}
                fill="#f59e0b"
                radius={[6, 6, 0, 0]}
              />
              <Bar
                dataKey="leadTime"
                name={t("analytics.avgLeadTime")}
                fill="#94a3b8"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
