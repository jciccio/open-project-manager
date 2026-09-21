"use client";

import { Zap, CheckCircle2, TrendingUp, Timer } from "lucide-react";
import { useTranslation } from "../../LanguageProvider";

interface Props {
  totalPoints: number;
  completedPoints: number;
  inProgressPoints: number;
  totalCards: number;
  completedCards: number;
  weeklyVelocity: number;
  avgCycleTimeDays: number;
}

export default function AnalyticsKpiCards({
  totalPoints,
  completedPoints,
  totalCards,
  completedCards,
  weeklyVelocity,
  avgCycleTimeDays,
}: Props) {
  const { t } = useTranslation();

  const completionPct =
    totalPoints > 0
      ? Math.round((completedPoints / totalPoints) * 100)
      : totalCards > 0
      ? Math.round((completedCards / totalCards) * 100)
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Weekly Velocity */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            {t("analytics.weeklyVelocity")}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400">
              {weeklyVelocity}
            </span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("analytics.ptsPerWeek")}
            </span>
          </div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-300 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
          <TrendingUp className="h-6 w-6" />
        </div>
      </div>

      {/* 2. Avg Cycle Time */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            {t("analytics.avgCycleTime")}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">
              {avgCycleTimeDays > 0 ? avgCycleTimeDays : "--"}
            </span>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("analytics.days")}
            </span>
          </div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
          <Timer className="h-6 w-6" />
        </div>
      </div>

      {/* 3. Completed Points & Rate */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            {t("analytics.pointsCompleted")}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {completedPoints}
            </span>
            <span className="text-xs font-semibold text-emerald-600/80 dark:text-emerald-400/80">
              ({completionPct}%)
            </span>
          </div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
          <CheckCircle2 className="h-6 w-6" />
        </div>
      </div>

      {/* 4. Total Scope Points / Cards */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="space-y-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            {t("analytics.totalPoints")}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {totalPoints}
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              ({totalCards} {t("analytics.totalCards").toLowerCase()})
            </span>
          </div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-purple-100 dark:bg-purple-500/10 border border-purple-300 dark:border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
          <Zap className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
