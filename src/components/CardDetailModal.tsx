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
  Pencil,
  Check,
  CheckCircle,
} from "lucide-react";
import { updateCard, deleteCard } from "@/actions/cards";
import { addComment, updateComment, deleteComment } from "@/actions/comments";
import { getLabels } from "@/actions/labels";
import { useTranslation } from "./LanguageProvider";

interface Props {
  card: {
    id: string;
    projectId: string;
    columnId: string;
    title: string;
    description: string | null;
    number?: number;
    project?: { key: string };
    priority: string;
    points: number | null;
    owner: string | null;
    dueDate: Date | string | null;
    completedAt?: Date | string | null;
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
    isDone?: boolean;
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
  const [columnId, setColumnId] = useState(card.columnId);
  const [priority, setPriority] = useState(card.priority);
  const [points, setPoints] = useState<string>(
    card.points !== null && card.points !== undefined ? String(card.points) : ""
  );
  const [owner, setOwner] = useState(card.owner || "");
  const [dueDate, setDueDate] = useState<string>(
    card.dueDate ? new Date(card.dueDate).toISOString().split("T")[0] : ""
  );
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    card.labels ? card.labels.map((l) => l.label.id) : []
  );

  const [availableLabels, setAvailableLabels] = useState<
    Array<{ id: string; name: string; color: string }>
  >([]);

  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentContent, setCommentContent] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { t } = useTranslation();

  useEffect(() => {
    async function loadLabels() {
      const res = await getLabels();
      if (res.success && res.data) {
        setAvailableLabels(res.data);
      }
    }
    loadLabels();
  }, []);

  async function handleSave() {
    setIsSaving(true);
    const parsedPoints = points.trim() === "" ? null : parseInt(points, 10);
    const res = await updateCard(card.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      columnId,
      priority,
      points: isNaN(parsedPoints as number) ? null : parsedPoints,
      owner: owner.trim() || undefined,
      dueDate: dueDate || undefined,
      labelIds: selectedLabelIds,
    });
    setIsSaving(false);

    if (res.success) {
      onRefresh();
    }
  }

  async function handleDelete() {
    if (!confirm(t("cardModal.deleteConfirm"))) return;
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

  async function handleSaveEditComment(commentId: string) {
    if (!editingCommentText.trim()) return;
    const res = await updateComment(commentId, editingCommentText.trim());
    if (res.success) {
      setEditingCommentId(null);
      setEditingCommentText("");
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
            {card.number && (
              <span className="rounded-md bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/30 px-2 py-0.5 text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
                {card.project?.key ? `${card.project.key}-${card.number}` : `#${card.number}`}
              </span>
            )}
            {card.completedAt && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                <span>Done ({new Date(card.completedAt).toLocaleDateString()})</span>
              </span>
            )}
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
                  <option value="LOW">{t("cardModal.priorityLow")}</option>
                  <option value="MEDIUM">{t("cardModal.priorityMedium")}</option>
                  <option value="HIGH">{t("cardModal.priorityHigh")}</option>
                  <option value="URGENT">{t("cardModal.priorityUrgent")}</option>
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
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder={t("cardModal.pointsPlaceholder")}
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

              {/* Due Date */}
              <div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <Calendar className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
                  <span>{t("cardModal.dueDate")}</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
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

          {/* Labels Manager Section */}
          <div>
            <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-2">
              <Tag className="h-3 w-3 text-amber-500 dark:text-amber-400" />
              <span>{t("cardModal.labels")}</span>
            </label>

            <div className="flex flex-wrap gap-1.5">
              {availableLabels.map((lbl) => {
                const isSelected = selectedLabelIds.includes(lbl.id);
                return (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => toggleLabel(lbl.id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                      isSelected
                        ? "ring-2 ring-indigo-500 shadow-xs text-white"
                        : "opacity-60 hover:opacity-100 text-white"
                    }`}
                    style={{ backgroundColor: lbl.color }}
                  >
                    {lbl.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comments Feed Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                {t("cardModal.activityComments")} ({card.comments ? card.comments.length : 0})
              </h4>
            </div>

            {/* Add Comment Form */}
            <form onSubmit={handleAddComment} className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={t("cardModal.yourName")}
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="w-1/3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  placeholder={t("cardModal.writeComment")}
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmittingComment}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  <Send className="h-3 w-3" />
                  <span>{t("cardModal.post")}</span>
                </button>
              </div>
            </form>

            {/* Comments List */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {card.comments && card.comments.length > 0 ? (
                card.comments.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-start justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 border border-slate-200 dark:border-slate-800"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200">
                          {c.author}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {editingCommentId === c.id ? (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="text"
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-indigo-500 px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEditComment(c.id)}
                            className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-md"
                            title="Save comment"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCommentId(null)}
                            className="p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md"
                            title="Cancel edit"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {c.content}
                        </p>
                      )}
                    </div>
                    {editingCommentId !== c.id && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCommentId(c.id);
                            setEditingCommentText(c.content);
                          }}
                          className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                          title="Edit comment"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(c.id)}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="Delete comment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic text-center py-2">
                  {t("cardModal.noComments")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
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
            disabled={isSaving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
          >
            {isSaving ? t("cardModal.saving") : t("cardModal.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
