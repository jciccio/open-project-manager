"use client";

import { Calendar, Hash, Layers } from "lucide-react";
import { TimeRangeOption, MetricMode } from "@/lib/analytics/types";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  timeRange: TimeRangeOption;
  setTimeRange: (range: TimeRangeOption) => void;
  metricMode: MetricMode;
  setMetricMode: (mode: MetricMode) => void;
}

export default function AnalyticsTimeFilter({
  timeRange,
  setTimeRange,
  metricMode,
  setMetricMode,
}: Props) {
  const { t } = useTranslation();

  const timeRanges: Array<{ id: TimeRangeOption; label: string }> = [
    { id: "7d", label: t("analytics.timeRange7d") },
    { id: "14d", label: t("analytics.timeRange14d") },
    { id: "30d", label: t("analytics.timeRange30d") },
    { id: "90d", label: t("analytics.timeRange90d") },
    { id: "all", label: t("analytics.timeRangeAll") },
  ];

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 glass-panel p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
      {/* Time Range Selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 px-2 mr-1">
          <Calendar className="h-4 w-4 text-indigo-500" />
          <span className="hidden md:inline">Time Range:</span>
        </div>
        {timeRanges.map((range) => {
          const isActive = timeRange === range.id;
          return (
            <button
              key={range.id}
              onClick={() => setTimeRange(range.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 ${
                isActive
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              {range.label}
            </button>
          );
        })}
      </div>

      {/* Metric Mode Toggle (Points vs Cards) */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl self-start sm:self-auto">
        <button
          onClick={() => setMetricMode("points")}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
            metricMode === "points"
              ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
          title={t("analytics.metricStoryPoints")}
        >
          <Hash className="h-3.5 w-3.5" />
          <span>{t("analytics.metricStoryPoints")}</span>
        </button>
        <button
          onClick={() => setMetricMode("cards")}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
            metricMode === "cards"
              ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
          title={t("analytics.metricCards")}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{t("analytics.metricCards")}</span>
        </button>
      </div>
    </div>
  );
}
