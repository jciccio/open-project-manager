"use client";

import { FolderKanban, CreditCard, Sparkles, CircleDashed, CheckCircle2, AlarmClock } from "lucide-react";
import ProjectCard from "@/components/ProjectCard";
import { useTranslation } from "./LanguageProvider";
import type { ProjectStats } from "@/lib/services/projectStats";

interface Props {
  user: any;
  projects: any[];
  stats?: Record<string, ProjectStats>;
  archivedCount: number;
}

export default function DashboardClient({ user, projects, stats, archivedCount }: Props) {
  const { t } = useTranslation();
  const totalCards = projects.reduce((acc, p) => acc + (stats?.[p.id]?.total ?? p._count?.cards ?? 0), 0);
  const workspaceTotals = stats
    ? projects.reduce(
        (acc, p) => ({
          open: acc.open + (stats[p.id]?.open ?? 0),
          done: acc.done + (stats[p.id]?.done ?? 0),
          overdue: acc.overdue + (stats[p.id]?.overdue ?? 0),
        }),
        { open: 0, done: 0, overdue: 0 }
      )
    : null;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
      {/* Banner & Stats */}
      <div className="rounded-3xl bg-gradient-to-r from-indigo-100 via-purple-50 to-slate-100 dark:from-indigo-900/40 dark:via-purple-900/20 dark:to-slate-900 border border-indigo-200 dark:border-indigo-500/20 p-8 mb-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="h-4 w-4" />
              <span>{t("dashboard.tagline")}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("dashboard.welcome")}, {user?.name || "User"} 👋
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
              {t("dashboard.subheading")}
            </p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-4 bg-white/90 dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center gap-3 px-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <FolderKanban className="h-5 w-5" />
              </div>
              <div>
                <span className="block font-extrabold text-xl text-slate-900 dark:text-white">
                  {projects.length}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                  {t("dashboard.projects")}
                </span>
              </div>
            </div>


            <div className="flex items-center gap-3 px-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <span className="block font-extrabold text-xl text-slate-900 dark:text-white">
                  {totalCards}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                  {t("dashboard.cards")}
                </span>
              </div>
            </div>

            {workspaceTotals && (
              <>
                <div className="flex items-center gap-3 px-3" data-testid="workspace-open">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                    <CircleDashed className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block font-extrabold text-xl text-slate-900 dark:text-white">{workspaceTotals.open}</span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                      {t("dashboard.openCards")}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-3" data-testid="workspace-done">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block font-extrabold text-xl text-slate-900 dark:text-white">{workspaceTotals.done}</span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                      {t("dashboard.doneCards")}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-3" data-testid="workspace-overdue">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                    <AlarmClock className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block font-extrabold text-xl text-slate-900 dark:text-white">{workspaceTotals.overdue}</span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                      {t("dashboard.overdueCards")}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Projects Section Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span>{t("dashboard.activeProjects")}</span>
          <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2.5 py-0.5 text-xs text-slate-700 dark:text-slate-400">
            {projects.length}
          </span>
        </h2>
      </div>

      {/* Projects Grid */}
      {projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project as any}
              stats={stats?.[project.id]}
              currentUserId={user?.userId || user?.id}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 mb-4">
            <FolderKanban className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t("dashboard.noActiveProjects")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            {t("dashboard.noActiveProjectsSub")}
          </p>
        </div>
      )}
    </main>
  );
}
