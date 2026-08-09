"use client";

import { useState } from "react";
import {
  Plus,
  ArrowLeft,
  Search,
  Filter,
  Archive,
  ArchiveRestore,
  Kanban as KanbanIcon,
  List as ListIcon,
  BarChart3,
  Calendar as CalendarIcon,
} from "lucide-react";
import Link from "next/link";
import KanbanColumn from "./KanbanColumn";
import CardDetailModal from "./CardDetailModal";
import ListView from "./views/ListView";
import AnalyticsView from "./views/AnalyticsView";
import CalendarView from "./views/CalendarView";

import { createColumn } from "@/actions/columns";
import { moveCard } from "@/actions/cards";
import { unarchiveProject } from "@/actions/projects";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";

interface Props {
  project: any;
}

type ViewMode = "kanban" | "list" | "analytics" | "calendar";

export default function KanbanBoard({ project }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [loadingCol, setLoadingCol] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const { t } = useTranslation();
  const router = useRouter();

  async function handleAddColumn(e: React.FormEvent) {
    e.preventDefault();
    if (!newColumnName.trim()) return;

    setLoadingCol(true);
    const res = await createColumn(project.id, newColumnName.trim());
    setLoadingCol(false);

    if (res.success) {
      setNewColumnName("");
      setIsAddingColumn(false);
      window.location.reload();
    }
  }

  async function handleRestore() {
    setRestoring(true);
    const res = await unarchiveProject(project.id);
    setRestoring(false);
    if (res.success) {
      router.push("/");
      router.refresh();
    }
  }

  function handleDragStartCard(e: React.DragEvent, cardId: string, sourceColumnId: string) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ cardId, sourceColumnId }));
  }

  async function handleDropCard(e: React.DragEvent, targetColumnId: string) {
    const rawData = e.dataTransfer.getData("text/plain");
    if (!rawData) return;

    try {
      const { cardId, sourceColumnId } = JSON.parse(rawData);
      if (sourceColumnId === targetColumnId) return;

      const targetCol = project.columns.find((c: any) => c.id === targetColumnId);
      const newOrder = targetCol?.cards ? targetCol.cards.length : 0;

      await moveCard(cardId, targetColumnId, newOrder);
      window.location.reload();
    } catch (err) {
      console.error("Drop card error:", err);
    }
  }

  // Filter cards by search & priority for Kanban view
  const columnsWithFilteredCards = project.columns.map((col: any) => {
    const filteredCards = (col.cards || []).filter((card: any) => {
      const matchesSearch =
        searchQuery === "" ||
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (card.description && card.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (card.owner && card.owner.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesPriority =
        priorityFilter === "ALL" || card.priority === priorityFilter;

      return matchesSearch && matchesPriority;
    });

    return { ...col, cards: filteredCards };
  });

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] overflow-hidden bg-slate-100/70 dark:bg-slate-950">
      {/* Archived Banner */}
      {project.isArchived && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-2 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 shrink-0">
          <div className="flex items-center gap-2 font-medium">
            <Archive className="h-4 w-4 text-amber-500" />
            <span>{t("kanban.archivedBanner")}</span>
          </div>
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors shadow-xs"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
            <span>{restoring ? t("kanban.restoring") : t("kanban.restoreButton")}</span>
          </button>
        </div>
      )}

      {/* Board Top Header & View Mode Switcher */}
      <div className="glass-panel border-b border-slate-200 dark:border-slate-800 px-6 py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={project.isArchived ? "/archived" : "/"}
              className="rounded-xl bg-slate-200/80 dark:bg-slate-800/80 p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors"
              title={project.isArchived ? "Back to Archived Projects" : "Back to Projects"}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div>
              <div className="flex items-center gap-2.5">
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ backgroundColor: project.color || "#6366f1" }}
                />
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {project.name}
                </h1>
                {project.isArchived && (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    {t("projectCard.archivedBadge")}
                  </span>
                )}
              </div>
              {project.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{project.description}</p>
              )}
            </div>
          </div>

          {/* View Mode Navigation Tabs & Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* View Mode Tab Switcher */}
            <div className="flex items-center rounded-xl bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-1">
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "kanban"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <KanbanIcon className="h-3.5 w-3.5" />
                <span>{t("views.kanban")}</span>
              </button>

              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "list"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <ListIcon className="h-3.5 w-3.5" />
                <span>{t("views.list")}</span>
              </button>

              <button
                onClick={() => setViewMode("analytics")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "analytics"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>{t("views.analytics")}</span>
              </button>

              <button
                onClick={() => setViewMode("calendar")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  viewMode === "calendar"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>{t("views.calendar")}</span>
              </button>
            </div>

            {/* Search & Priority Filters */}
            {viewMode !== "analytics" && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t("kanban.searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-40 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs">
                  <Filter className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="bg-transparent text-slate-900 dark:text-white focus:outline-none cursor-pointer"
                  >
                    <option value="ALL">{t("kanban.allPriorities")}</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Dynamic View Mode Content Body */}
      <div className="flex-1 overflow-auto">
        {viewMode === "kanban" && (
          <div className="p-6 flex items-start gap-5 overflow-x-auto min-h-full">
            {columnsWithFilteredCards.map((column: any) => (
              <KanbanColumn
                key={column.id}
                column={column}
                onCardClick={(card) => setActiveCard(card)}
                onRefresh={() => window.location.reload()}
                onDragStartCard={handleDragStartCard}
                onDropCard={handleDropCard}
              />
            ))}

            {/* Add Column Button / Form */}
            {isAddingColumn ? (
              <form
                onSubmit={handleAddColumn}
                className="w-80 shrink-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-4 space-y-3 shadow-lg"
              >
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("kanban.addColumnTitle")}</h4>
                <input
                  type="text"
                  placeholder={t("kanban.columnNamePlaceholder")}
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingColumn(false)}
                    className="rounded-lg px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  >
                    {t("kanban.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={loadingCol}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {t("kanban.create")}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setIsAddingColumn(true)}
                className="flex h-32 w-80 shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800/80 bg-white/50 dark:bg-slate-900/30 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:border-indigo-500/40 hover:bg-white dark:hover:bg-slate-900/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span>{t("kanban.addColumn")}</span>
              </button>
            )}
          </div>
        )}

        {viewMode === "list" && (
          <ListView
            project={project}
            onCardClick={(card) => setActiveCard(card)}
            onRefresh={() => window.location.reload()}
            searchQuery={searchQuery}
            priorityFilter={priorityFilter}
          />
        )}

        {viewMode === "analytics" && <AnalyticsView project={project} />}

        {viewMode === "calendar" && (
          <CalendarView
            project={project}
            onCardClick={(card) => setActiveCard(card)}
            searchQuery={searchQuery}
            priorityFilter={priorityFilter}
          />
        )}
      </div>

      {/* Card Detail Modal */}
      {activeCard && (
        <CardDetailModal
          card={activeCard}
          columns={project.columns}
          onClose={() => setActiveCard(null)}
          onRefresh={() => window.location.reload()}
        />
      )}
    </div>
  );
}
