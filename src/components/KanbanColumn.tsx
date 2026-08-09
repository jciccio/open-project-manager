"use client";

import { useState } from "react";
import { Plus, Trash2, Layers } from "lucide-react";
import TaskCard from "./TaskCard";
import { createCard } from "@/actions/cards";
import { deleteColumn } from "@/actions/columns";
import { useTranslation } from "./LanguageProvider";

interface Props {
  column: {
    id: string;
    projectId: string;
    name: string;
    order: number;
    cards: Array<any>;
  };
  onCardClick: (card: any) => void;
  onRefresh: () => void;
  onDragStartCard: (e: React.DragEvent, cardId: string, sourceColumnId: string) => void;
  onDropCard: (e: React.DragEvent, targetColumnId: string) => void;
}

export default function KanbanColumn({
  column,
  onCardClick,
  onRefresh,
  onDragStartCard,
  onDropCard,
}: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newPoints, setNewPoints] = useState<number | "">("");
  const [newOwner, setNewOwner] = useState("");
  const [isHoveredOver, setIsHoveredOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setLoading(true);
    const res = await createCard({
      projectId: column.projectId,
      columnId: column.id,
      title: newTitle.trim(),
      priority: newPriority,
      points: newPoints === "" ? null : Number(newPoints),
      owner: newOwner.trim() || null,
    });
    setLoading(false);

    if (res.success) {
      setNewTitle("");
      setNewPoints("");
      setNewOwner("");
      setIsAdding(false);
      onRefresh();
    }
  }

  async function handleDeleteColumn() {
    if (!confirm(t("kanban.confirmDeleteColumn", { name: column.name }))) return;
    const res = await deleteColumn(column.id);
    if (res.success) {
      onRefresh();
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsHoveredOver(true);
  }

  function handleDragLeave() {
    setIsHoveredOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsHoveredOver(false);
    onDropCard(e, column.id);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col w-80 shrink-0 rounded-2xl bg-slate-200/70 dark:bg-slate-900/70 border border-slate-300/80 dark:border-slate-800 p-4 transition-colors ${
        isHoveredOver ? "border-indigo-500/50 bg-indigo-50/50 dark:bg-indigo-950/20" : ""
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-300 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-500" />
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{column.name}</h3>
          <span className="rounded-full bg-slate-300/80 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-400">
            {column.cards?.length || 0}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsAdding(true)}
            className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            title={t("kanban.addCard")}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={handleDeleteColumn}
            className="rounded-lg p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-500 transition-colors"
            title="Delete column"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Cards List */}
      <div className="flex-1 space-y-3 min-h-[150px] overflow-y-auto pr-0.5">
        {column.cards && column.cards.length > 0 ? (
          column.cards.map((card) => (
            <div
              key={card.id}
              draggable
              onDragStart={(e) => onDragStartCard(e, card.id, column.id)}
            >
              <TaskCard card={card} onClick={() => onCardClick(card)} />
            </div>
          ))
        ) : (
          <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-4 text-center">
            <Layers className="h-6 w-6 text-slate-400 dark:text-slate-600 mb-1.5" />
            <p className="text-xs text-slate-500 dark:text-slate-500 font-medium">{t("kanban.dropHere")}</p>
          </div>
        )}
      </div>

      {/* Inline Quick Add Form */}
      {isAdding ? (
        <form onSubmit={handleAddCard} className="mt-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-indigo-500/30 p-3 space-y-2.5 shadow-lg">
          <input
            type="text"
            placeholder={t("kanban.taskTitlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            autoFocus
          />

          <div className="flex gap-2">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-900 dark:text-white focus:outline-none"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>

            <input
              type="number"
              placeholder="Pts"
              value={newPoints}
              onChange={(e) => setNewPoints(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-16 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>

          <input
            type="text"
            placeholder={t("kanban.assigneePlaceholder")}
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="rounded-lg px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              {t("kanban.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {t("kanban.addCard")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-700 hover:bg-slate-200/50 dark:hover:bg-slate-800/40 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>{t("kanban.addCard")}</span>
        </button>
      )}
    </div>
  );
}
