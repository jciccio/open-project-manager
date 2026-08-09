"use client";

import { useMemo } from "react";
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
import { Zap, CheckCircle2, Clock, Layers, Users, BarChart3 } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useTranslation } from "../LanguageProvider";

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

  // Aggregate KPI metrics and charts data
  const {
    totalPoints,
    completedPoints,
    inProgressPoints,
    totalCards,
    pointsByColumnData,
    priorityData,
    assigneeData,
  } = useMemo(() => {
    let totPoints = 0;
    let compPoints = 0;
    let progPoints = 0;
    let totCards = 0;

    const colData: any[] = [];
    const priorityCounts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    const assigneeMap: Record<string, { name: string; points: number; cards: number }> = {};

    project.columns.forEach((col: any) => {
      let colPoints = 0;
      const isDoneCol = col.name.toLowerCase().includes("done") || col.name.toLowerCase().includes("complete");

      (col.cards || []).forEach((card: any) => {
        totCards++;
        const pts = card.points || 0;
        totPoints += pts;
        colPoints += pts;

        if (isDoneCol) {
          compPoints += pts;
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
      pointsByColumnData: colData,
      priorityData: prioData,
      assigneeData: assData,
    };
  }, [project]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Top KPI Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Total Points */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("analytics.totalPoints")}
            </span>
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 block">
              {totalPoints} <span className="text-xs text-purple-600 dark:text-purple-400 font-bold">{t("kanban.pts")}</span>
            </span>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-purple-100 dark:bg-purple-500/10 border border-purple-300 dark:border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <Zap className="h-6 w-6" />
          </div>
        </div>

        {/* Completed Points */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("analytics.pointsCompleted")}
            </span>
            <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 block">
              {completedPoints} <span className="text-xs text-emerald-600/80 dark:text-emerald-400/80 font-bold">{t("kanban.pts")}</span>
            </span>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        </div>

        {/* In Progress Points */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("analytics.inProgress")}
            </span>
            <span className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1 block">
              {inProgressPoints} <span className="text-xs text-indigo-600/80 dark:text-indigo-400/80 font-bold">{t("kanban.pts")}</span>
            </span>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-300 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Clock className="h-6 w-6" />
          </div>
        </div>

        {/* Total Tasks */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              {t("analytics.totalCards")}
            </span>
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 block">
              {totalCards}
            </span>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-blue-100 dark:bg-blue-500/10 border border-blue-300 dark:border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Layers className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Chart 1: Story Points Addressed per Column */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t("analytics.pointsByStatus")}</h3>
          </div>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pointsByColumnData}>
                <XAxis dataKey="name" stroke={textColor} fontSize={12} />
                <YAxis stroke={textColor} fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: "12px", color: isDark ? "#fff" : "#0f172a" }}
                />
                <Bar dataKey="points" fill="#6366f1" radius={[8, 8, 0, 0]} name="Story Points" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Priority Breakdown */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t("analytics.priorityDistribution")}</h3>
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
                  contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: "12px", color: isDark ? "#fff" : "#0f172a" }}
                />
                <Legend formatter={(value) => <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Assignee Workload */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-800 space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{t("analytics.assigneeWorkload")}</h3>
          </div>
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assigneeData}>
                <XAxis dataKey="name" stroke={textColor} fontSize={12} />
                <YAxis stroke={textColor} fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: "12px", color: isDark ? "#fff" : "#0f172a" }}
                />
                <Bar dataKey="points" fill="#8b5cf6" radius={[8, 8, 0, 0]} name="Story Points" />
                <Bar dataKey="cards" fill="#3b82f6" radius={[8, 8, 0, 0]} name="Total Cards" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
