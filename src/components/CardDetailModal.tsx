"use client";

import { useEffect, useState } from "react";
import {
  X,
  Trash2,
  Send,
  Zap,
  User,
  Calendar,
  Tag,
  MessageSquare,
  Sparkles,
  Layers,
} from "lucide-react";
import { updateCard, deleteCard } from "@/actions/cards";
import { addComment, deleteComment } from "@/actions/comments";
import { getLabels } from "@/actions/labels";
import { useTranslation } from "./LanguageProvider";

interface Props {
  card: {
    id: string;
    projectId: string;
    columnId: string;
    title: string;
    description: string | null;
    priority: string;
    points: number | null;
    owner: string | null;
    dueDate: Date | string | null;
    labels: Array<{
      label: {
        id: string;
        name: string;
        color: string;
      };
    }>;
    comments: Array<{
      id: string;
      author: string;
      content: string;
      createdAt: Date | string;
    }>;
  };
  columns: Array<{
    id: string;
    name: string;
  }>;
  onClose: () => void;
  onRefresh: () => void;
}

export default function CardDetailModal({
  card,
  columns,
  onClose,
  onRefresh,
}: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || "");
  const [priority, setPriority] = useState(card.priority);
  const [points, setPoints] = useState<number | "">(card.points ?? "");
  const [owner, setOwner] = useState(card.owner || "");
  const [columnId, setColumnId] = useState(card.columnId);
  const [dueDate, setDueDate] = useState<string>(
    card.dueDate
      ? new Date(card.dueDate).toISOString().substring(0, 10)
      : ""
  );

  const [availableLabels, setAvailableLabels] = useState<any[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    card.labels.map((l) => l.label.id)
  );

  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentContent, setCommentContent] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    getLabels().then((res) => {
      if (res.success && res.data) {
        setAvailableLabels(res.data);
      }
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const res = await updateCard(card.id, {
      title,
      description,
      priority,
      points: points === "" ? null : Number(points),
      owner: owner || null,
      columnId,
      dueDate: dueDate || null,
      labelIds: selectedLabelIds,
    });
    setSaving(false);

    if (res.success) {
      onRefresh();
      onClose();
    }
  }

  async function handleDelete() {
    if (!confirm(t("cardModal.confirmDeleteCard"))) return;
    setDeleting(true);
    const res = await deleteCard(card.id);
    setDeleting(false);

    if (res.success) {
      onRefresh();
      onClose();
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentContent.trim()) return;

    setIsSubmittingComment(true);
    const res = await addComment(
      card.id,
      commentAuthor.trim() || "Team Member",
      commentContent.trim()
    );
    setIsSubmittingComment(false);

    if (res.success) {
      setCommentContent("");
      onRefresh();
    }
  }

  async function handleDeleteComment(commentId: string) {
    const res = await deleteComment(commentId);
    if (res.success) {
      onRefresh();
    }
  }

  function toggleLabel(id: string) {
    if (selectedLabelIds.includes(id)) {
      setSelectedLabelIds(selectedLabelIds.filter((l) => l !== id));
    } else {
      setSelectedLabelIds([...selectedLabelIds, id]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {t("cardModal.title")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-500 transition-colors"
              title="Delete task card"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Card Title & Column Status */}
          <div className="space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/80 px-3.5 py-2.5 text-lg font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder={t("cardModal.cardTitlePlaceholder")}
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Column Selector */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <Layers className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                  <span>{t("cardModal.column")}</span>
                </label>
                <select
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority Selector */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <Sparkles className="h-3 w-3 text-amber-500 dark:text-amber-400" />
                  <span>{t("cardModal.priority")}</span>
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>

              {/* Points */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <Zap className="h-3 w-3 text-purple-500 dark:text-purple-400" />
                  <span>{t("cardModal.points")}</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={points}
                  onChange={(e) => setPoints(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 3"
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Owner / Assignee */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <User className="h-3 w-3 text-blue-500 dark:text-blue-400" />
                  <span>{t("cardModal.owner")}</span>
                </label>
                <input
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder={t("cardModal.assigneePlaceholder")}
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("cardModal.description")}
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("cardModal.descriptionPlaceholder")}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Due Date & Labels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <Calendar className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>{t("cardModal.dueDate")}</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <Tag className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
                <span>{t("cardModal.labels")}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableLabels.map((lbl) => {
                  const isSelected = selectedLabelIds.includes(lbl.id);
                  return (
                    <button
                      type="button"
                      key={lbl.id}
                      onClick={() => toggleLabel(lbl.id)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-all border ${
                        isSelected
                          ? "ring-2 ring-indigo-500 border-transparent text-white"
                          : "opacity-60 hover:opacity-100 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                      }`}
                      style={{ backgroundColor: isSelected ? lbl.color : `${lbl.color}20` }}
                    >
                      {lbl.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Comments Feed */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("cardModal.comments")} ({card.comments?.length || 0})
              </h4>
            </div>

            {/* Comment Input */}
            <form onSubmit={handleAddComment} className="space-y-2 mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("cardModal.yourName")}
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="w-1/3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder={t("cardModal.writeComment")}
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmittingComment}
                  className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>

            {/* Comment List */}
            <div className="space-y-2.5 max-h-40 overflow-y-auto pr-1">
              {card.comments && card.comments.length > 0 ? (
                card.comments.map((cm) => (
                  <div
                    key={cm.id}
                    className="flex items-start justify-between rounded-lg bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-600 dark:text-indigo-300">
                          {cm.author}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(cm.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-700 dark:text-slate-300 leading-relaxed">
                        {cm.content}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteComment(cm.id)}
                      className="text-slate-400 hover:text-red-500 p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic">{t("cardModal.noComments")}</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            {t("kanban.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
          >
            {saving ? t("cardModal.saving") : t("cardModal.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
