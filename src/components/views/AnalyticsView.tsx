"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Zap, Users, BarChart3 } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useTranslation } from "../LanguageProvider";
import { TimeRangeOption, MetricMode, AnalyticsCard } from "@/lib/analytics/types";
import {
  getDateWindow,
  generateDateBuckets,
  calculateVelocity,
  calculateBurndown,
  calculateCycleTime,
  calculateCumulativeFlow,
} from "@/lib/analytics";
import AnalyticsTimeFilter from "./analytics/AnalyticsTimeFilter";
import AnalyticsKpiCards from "./analytics/AnalyticsKpiCards";
import VelocityChart from "./analytics/VelocityChart";
import BurndownChart from "./analytics/BurndownChart";
import CycleTimeChart from "./analytics/CycleTimeChart";
import CumulativeFlowChart from "./analytics/CumulativeFlowChart";

interface Props {
  project: any;
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "#64748b",
  MEDIUM: "#3b82f6",
  HIGH: "#f59e0b",
  URGENT: "#ef4444",
};

export default function AnalyticsView({ project }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";
  const textColor = isDark ? "#94a3b8" : "#475569";
  const tooltipBg = isDark ? "#0f172a" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#cbd5e1";

  // Filter state
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("30d");
  const [metricMode, setMetricMode] = useState<MetricMode>("points");

  // Flatten all cards from columns
  const allCards: AnalyticsCard[] = useMemo(() => {
    if (!project?.columns) return [];
    return project.columns.flatMap((col: any) =>
      (col.cards || []).map((card: any) => ({
        ...card,
        columnId: col.id,
      }))
    );
  }, [project]);

  // Generate temporal windows & buckets
  const { buckets, dateWindow } = useMemo(() => {
    const window = getDateWindow(timeRange, new Date(), allCards);
    const b = generateDateBuckets(window.startDate, window.endDate, window.bucketInterval);
    return { buckets: b, dateWindow: window };
  }, [timeRange, allCards]);

  // Calculate advanced metrics
  const velocityResult = useMemo(
    () => calculateVelocity(allCards, buckets),
    [allCards, buckets]
  );

  const burndownResult = useMemo(
    () => calculateBurndown(allCards, buckets, metricMode),
    [allCards, buckets, metricMode]
  );

  const cycleTimeResult = useMemo(
    () => calculateCycleTime(allCards, dateWindow.startDate, dateWindow.endDate),
    [allCards, dateWindow]
  );

  const cumulativeFlowResult = useMemo(
    () => calculateCumulativeFlow(project.columns || [], allCards, buckets, metricMode),
    [project.columns, allCards, buckets, metricMode]
  );

  // Aggregate static distribution metrics (points by column, priority, assignee workload)
  const {
    totalPoints,
    completedPoints,
    inProgressPoints,
    totalCards,
    completedCards,
    pointsByColumnData,
    priorityData,
    assigneeData,
  } = useMemo(() => {
    let totPoints = 0;
    let compPoints = 0;
    let progPoints = 0;
    let totCards = 0;
    let compCards = 0;

    const colData: any[] = [];
    const priorityCounts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    const assigneeMap: Record<string, { name: string; points: number; cards: number }> = {};

    (project?.columns || []).forEach((col: any) => {
      let colPoints = 0;
      const isDoneCol =
        col.isDone ||
        col.name.toLowerCase().includes("done") ||
        col.name.toLowerCase().includes("complete");

      (col.cards || []).forEach((card: any) => {
        totCards++;
        const pts = card.points || 0;
        totPoints += pts;
        colPoints += pts;

        if (isDoneCol || card.completedAt) {
          compPoints += pts;
          compCards++;
        } else if (col.name.toLowerCase().includes("progress")) {
          progPoints += pts;
        }

        // Priority count
        if (card.priority && priorityCounts[card.priority] !== undefined) {
          priorityCounts[card.priority]++;
        }

        // Assignee map
        const ownerName = card.owner ? card.owner : "Unassigned";
        if (!assigneeMap[ownerName]) {
          assigneeMap[ownerName] = { name: ownerName, points: 0, cards: 0 };
        }
        assigneeMap[ownerName].points += pts;
        assigneeMap[ownerName].cards += 1;
      });

      colData.push({
        name: col.name,
        points: colPoints,
        cards: col.cards?.length || 0,
      });
    });

    const prioData = Object.keys(priorityCounts).map((key) => ({
      name: key,
      value: priorityCounts[key],
      color: PRIORITY_COLORS[key],
    }));

    const assData = Object.values(assigneeMap);

    return {
      totalPoints: totPoints,
      completedPoints: compPoints,
      inProgressPoints: progPoints,
      totalCards: totCards,
      completedCards: compCards,
      pointsByColumnData: colData,
      priorityData: prioData,
      assigneeData: assData,
    };
  }, [project]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Time Range and Metric Controls Filter */}
      <AnalyticsTimeFilter
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        metricMode={metricMode}
        setMetricMode={setMetricMode}
      />

      {/* Top KPI Cards */}
      <AnalyticsKpiCards
        totalPoints={totalPoints}
        completedPoints={completedPoints}
        inProgressPoints={inProgressPoints}
        totalCards={totalCards}
        completedCards={completedCards}
        weeklyVelocity={velocityResult.averageWeeklyVelocity}
        avgCycleTimeDays={cycleTimeResult.avgCycleTimeDays}
      />

      {/* Primary Analytics Charts: Velocity & Burndown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VelocityChart
          intervals={velocityResult.intervals}
          metricMode={metricMode}
          isDark={isDark}
        />
        <BurndownChart
          points={burndownResult.points}
          startRemaining={burndownResult.startRemaining}
          currentRemaining={burndownResult.currentRemaining}
          metricMode={metricMode}
          isDark={isDark}
        />
      </div>

      {/* Advanced Analytics Charts: Lead/Cycle Time & Cumulative Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CycleTimeChart summary={cycleTimeResult} isDark={isDark} />
        <CumulativeFlowChart
          points={cumulativeFlowResult.points}
          columns={cumulativeFlowResult.columns}
          metricMode={metricMode}
          isDark={isDark}
        />
      </div>

      {/* Distribution Section: Points by Status & Priority Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Story Points per Column */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.pointsByStatus")}
            </h3>
          </div>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pointsByColumnData}>
                <XAxis dataKey="name" stroke={textColor} fontSize={12} tickLine={false} />
                <YAxis stroke={textColor} fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    borderRadius: "12px",
                    color: isDark ? "#fff" : "#0f172a",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                  }}
                />
                <Bar
                  dataKey="points"
                  fill="#6366f1"
                  radius={[8, 8, 0, 0]}
                  name={t("analytics.metricStoryPoints")}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.priorityDistribution")}
            </h3>
          </div>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {priorityData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
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
                  formatter={(value) => (
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold">
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Assignee Workload */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t("analytics.assigneeWorkload")}
            </h3>
          </div>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assigneeData}>
                <XAxis dataKey="name" stroke={textColor} fontSize={12} tickLine={false} />
                <YAxis stroke={textColor} fontSize={12} tickLine={false} />
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
                <Bar
                  dataKey="points"
                  fill="#8b5cf6"
                  radius={[8, 8, 0, 0]}
                  name={t("analytics.metricStoryPoints")}
                />
                <Bar
                  dataKey="cards"
                  fill="#3b82f6"
                  radius={[8, 8, 0, 0]}
                  name={t("analytics.totalCards")}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
