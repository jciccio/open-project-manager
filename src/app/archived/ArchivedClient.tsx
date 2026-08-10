"use client";

import { useState } from "react";
import { Archive, ArrowLeft, RotateCcw, Layout, Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProjectCard from "@/components/ProjectCard";
import { unarchiveCard } from "@/actions/cards";
import { useTranslation } from "@/components/LanguageProvider";

interface Props {
  archivedProjects: any[];
  archivedCards: any[];
}

export default function ArchivedClient({ archivedProjects, archivedCards }: Props) {
  const [activeTab, setActiveTab] = useState<"projects" | "cards">("projects");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useTranslation();

  async function handleRestoreCard(id: string) {
    setRestoringId(id);
    const res = await unarchiveCard(id);
    setRestoringId(null);
    if (res.success) {
      router.refresh();
    }
  }

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

          {/* Tab Filter buttons */}
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-950/60 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setActiveTab("projects")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === "projects"
                  ? "bg-amber-500 text-white shadow-md"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Layout className="h-4 w-4" />
              <span>Projects ({archivedProjects.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("cards")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === "cards"
                  ? "bg-amber-500 text-white shadow-md"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>Cards ({archivedCards.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (
        archivedProjects.length > 0 ? (
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
          </div>
        )
      )}

      {/* Cards Tab */}
      {activeTab === "cards" && (
        archivedCards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {archivedCards.map((card) => {
              const identifier = card.project?.key ? `${card.project.key}-${card.number}` : `#${card.number}`;
              return (
                <div
                  key={card.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="rounded-md bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-2 py-0.5 text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
                        {identifier}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {card.project?.name} ({card.column?.name})
                      </span>
                    </div>
                    <h4 className="font-bold text-base text-slate-900 dark:text-white mb-1">
                      {card.title}
                    </h4>
                    {card.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {card.description}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
                    <button
                      onClick={() => handleRestoreCard(card.id)}
                      disabled={restoringId === card.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{restoringId === card.id ? "Restoring..." : "Restore Card"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-4">
              <Archive className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">No Archived Cards</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Cards you archive will appear here where you can restore them anytime.
            </p>
          </div>
        )
      )}
    </main>
  );
}
