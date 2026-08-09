"use client";

import Link from "next/link";
import { FolderKanban, Layers, CreditCard, Trash2, ArrowRight, Archive, ArchiveRestore } from "lucide-react";
import { deleteProject, archiveProject, unarchiveProject } from "@/actions/projects";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";

interface Props {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    isArchived?: boolean;
    createdAt: Date;
    _count: {
      cards: number;
      columns: number;
    };
  };
  onDeleteSuccess?: () => void;
}

export default function ProjectCard({ project, onDeleteSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const router = useRouter();

  async function handleArchiveToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);

    if (project.isArchived) {
      await unarchiveProject(project.id);
    } else {
      await archiveProject(project.id);
    }

    setLoading(false);
    if (onDeleteSuccess) {
      onDeleteSuccess();
    } else {
      router.refresh();
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t("projectCard.confirmDelete", { name: project.name }))) {
      return;
    }

    setLoading(true);
    const res = await deleteProject(project.id);
    setLoading(false);

    if (res.success && onDeleteSuccess) {
      onDeleteSuccess();
    } else {
      router.refresh();
    }
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-all">
      {/* Accent Bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 rounded-t-2xl opacity-90 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: project.color || "#6366f1" }}
      />

      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl p-2 text-white shadow-xs"
              style={{ backgroundColor: `${project.color}25`, border: `1px solid ${project.color}50` }}
            >
              <FolderKanban className="h-5 w-5" style={{ color: project.color }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                  {project.name}
                </h3>
                {project.isArchived && (
                  <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    {t("projectCard.archivedBadge")}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("projectCard.created")} {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleArchiveToggle}
              disabled={loading}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              title={project.isArchived ? t("projectCard.restoreTooltip") : t("projectCard.archiveTooltip")}
            >
              {project.isArchived ? (
                <ArchiveRestore className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
              title={t("projectCard.deleteTooltip")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
          {project.description || "No description provided."}
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            <span>{project._count?.columns || 0} {t("projectCard.columns")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
            <span>{project._count?.cards || 0} {t("projectCard.cards")}</span>
          </div>
        </div>

        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 group-hover:translate-x-0.5 transition-transform"
        >
          <span>{t("projectCard.openBoard")}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
