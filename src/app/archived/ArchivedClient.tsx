"use client";

import { Archive, ArrowLeft } from "lucide-react";
import Link from "next/link";
import ProjectCard from "@/components/ProjectCard";
import { useTranslation } from "@/components/LanguageProvider";

interface Props {
  archivedProjects: any[];
}

export default function ArchivedClient({ archivedProjects }: Props) {
  const { t } = useTranslation();

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
      {/* Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-amber-100 via-slate-100 to-slate-100 dark:from-amber-900/30 dark:via-slate-900 dark:to-slate-900 border border-amber-300 dark:border-amber-500/20 p-8 mb-8 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="rounded-xl bg-slate-200 dark:bg-slate-800/80 p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors mr-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-semibold uppercase tracking-wider">
                <Archive className="h-4 w-4" />
                <span>{t("archived.tagline")}</span>
              </div>
            </div>

            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-2">
              {t("archived.title")}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
              {t("archived.subheading")}
            </p>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      {archivedProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {archivedProjects.map((project) => (
            <ProjectCard key={project.id} project={project as any} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-4">
            <Archive className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t("archived.noArchived")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            {t("archived.noArchivedSub")}
          </p>
          <Link
            href="/"
            className="mt-4 rounded-xl bg-slate-200 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            {t("archived.backToDashboard")}
          </Link>
        </div>
      )}
    </main>
  );
}
