"use client";

import { useState } from "react";
import { Zap, Calendar, User, MessageSquare } from "lucide-react";
import { moveCard } from "@/actions/cards";
import { useTranslation } from "../LanguageProvider";

interface Props {
  project: any;
  onCardClick: (card: any) => void;
  onRefresh: () => void;
  searchQuery: string;
  priorityFilter: string;
  typeFilter?: string;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LOW: { bg: "bg-slate-100 dark:bg-slate-500/10", text: "text-slate-600 dark:text-slate-400", border: "border-slate-300 dark:border-slate-500/20" },
  MEDIUM: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-200 dark:border-blue-500/20" },
  HIGH: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-500/20" },
  URGENT: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-500/20" },
};

export default function ListView({
  project,
  onCardClick,
  onRefresh,
  searchQuery,
  priorityFilter,
  typeFilter = "ALL",
}: Props) {
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const { t } = useTranslation();

  async function handleColumnChange(cardId: string, newColumnId: string) {
    setMovingCardId(cardId);
    const targetCol = project.columns.find((c: any) => c.id === newColumnId);
    const newOrder = targetCol?.cards ? targetCol.cards.length : 0;

    await moveCard(cardId, newColumnId, newOrder);
    setMovingCardId(null);
    onRefresh();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {project.columns.map((col: any) => {
        const filteredCards = (col.cards || []).filter((card: any) => {
          const matchesSearch =
            searchQuery === "" ||
            card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (card.description && card.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (card.owner && card.owner.toLowerCase().includes(searchQuery.toLowerCase()));

          const matchesPriority =
            priorityFilter === "ALL" || card.priority === priorityFilter;

          const matchesType =
            typeFilter === "ALL" ||
            (typeFilter === "NONE" ? !card.typeId : card.typeId === typeFilter);

          return matchesSearch && matchesPriority && matchesType;
        });

        return (
          <div
            key={col.id}
            className="glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3"
          >
            {/* Group Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-3 w-3 rounded-full bg-indigo-600 dark:bg-indigo-500" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">{col.name}</h3>
                <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-400">
                  {filteredCards.length} {t("kanban.tasks")}
                </span>
              </div>
            </div>

            {/* List Table */}
            {filteredCards.length > 0 ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/60 overflow-hidden">
                {filteredCards.map((card: any) => {
                  const priorityStyle =
                    PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.MEDIUM;

                  return (
                    <div
                      key={card.id}
                      onClick={() => onCardClick(card)}
                      className="group flex flex-col md:flex-row md:items-center justify-between p-3.5 hover:bg-slate-100/80 dark:hover:bg-slate-800/40 rounded-xl transition-all cursor-pointer gap-3"
                    >
                      {/* Left: Title & Labels */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                              {card.title}
                            </span>

                            {card.labels?.map(({ label }: any) => (
                              <span
                                key={label.id}
                                className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
                                style={{ backgroundColor: label.color }}
                              >
                                {label.name}
                              </span>
                            ))}
                          </div>
                          {card.description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                              {card.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right: Attributes */}
                      <div className="flex items-center gap-4 flex-wrap text-xs shrink-0">
                        {/* Status Column Selector */}
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1"
                        >
                          <select
                            value={col.id}
                            disabled={movingCardId === card.id}
                            onChange={(e) => handleColumnChange(card.id, e.target.value)}
                            className="rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                          >
                            {project.columns.map((c: any) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Priority Badge */}
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}
                        >
                          {card.priority}
                        </span>

                        {/* Points */}
                        {card.points !== null && card.points !== undefined && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20">
                            <Zap className="h-2.5 w-2.5" />
                            <span>{card.points} {t("kanban.pts")}</span>
                          </span>
                        )}

                        {/* Assignee */}
                        {card.owner ? (
                          <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
                            <User className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                            <span>{card.owner}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-[11px] italic">Unassigned</span>
                        )}

                        {/* Due Date */}
                        {card.dueDate ? (
                          <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <Calendar className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                            <span>
                              {new Date(card.dueDate).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              })}
                            </span>
                          </div>
                        ) : null}

                        {/* Comments count */}
                        {card.comments && card.comments.length > 0 && (
                          <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <MessageSquare className="h-3 w-3 text-slate-400" />
                            <span>{card.comments.length}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic py-2">No tasks in this column.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
