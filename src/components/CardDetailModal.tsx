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
  Link2,
  ShieldAlert,
  Plus,
  Archive,
  Paperclip,
  History,
  Activity as ActivityIcon,
  ArrowRight,
  Clock,
  CheckSquare,
  CornerDownRight,
  Unlink,
} from "lucide-react";
import { createCard, updateCard, deleteCard, archiveCard, getCardByIdentifier, addCardLink, removeCardLink } from "@/actions/cards";
import { getProjectById } from "@/actions/projects";
import { addComment, updateComment, deleteComment } from "@/actions/comments";
import { getCardActivity } from "@/actions/activity";
import { uploadAttachment, listAttachments, deleteAttachment } from "@/actions/attachments";
import { getLabels } from "@/actions/labels";
import { getCardTypes } from "@/actions/cardTypes";
import { addCardRelation, removeCardRelation, getCardRelations } from "@/actions/relations";
import { useTranslation } from "./LanguageProvider";
import MarkdownEditor from "./MarkdownEditor";
import CardTypeManagerModal from "./CardTypeManagerModal";
import { CardTypeIcon } from "./cardTypeIcons";

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
    typeId?: string | null;
    type?: { id: string; name: string; icon: string; color: string } | null;
    parentId?: string | null;
    parent?: {
      id: string;
      number?: number;
      title: string;
      columnId?: string;
    } | null;
    children?: Array<{
      id: string;
      number?: number;
      title: string;
      completedAt?: Date | string | null;
      dueDate?: Date | string | null;
      columnId: string;
      column?: {
        id: string;
        name: string;
        isDone?: boolean;
      };
      assignees?: Array<{
        user: { id: string; name: string; email: string };
      }>;
    }>;
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
    activities?: Array<{
      id: string;
      cardId: string;
      actorUserId: string;
      type: string;
      fromValue: string | null;
      toValue: string | null;
      createdAt: Date | string;
    }>;
    links?: Array<{
      id: string;
      url: string;
      title: string | null;
    }>;
  };
  columns: Array<{
    id: string;
    name: string;
    isDone?: boolean;
  }>;
  onClose: () => void;
  onRefresh: () => void;
  onOpenCard?: (cardId: string) => void;
}

export default function CardDetailModal({
  card,
  columns,
  onClose,
  onRefresh,
  onOpenCard,
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
  const [typeId, setTypeId] = useState<string>(card.typeId || card.type?.id || "");

  // Subtask & Parent state
  const [subtasks, setSubtasks] = useState<Array<any>>(card.children || []);
  const [parentCard, setParentCard] = useState<any>(card.parent || null);
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isSubmittingSubtask, setIsSubmittingSubtask] = useState(false);
  const [subtaskError, setSubtaskError] = useState("");
  const [subtaskLoadingId, setSubtaskLoadingId] = useState<string | null>(null);

  const [availableLabels, setAvailableLabels] = useState<
    Array<{ id: string; name: string; color: string }>
  >([]);
  const [availableCardTypes, setAvailableCardTypes] = useState<
    Array<{ id: string; name: string; icon: string; color: string }>
  >([]);
  const [isCardTypeModalOpen, setIsCardTypeModalOpen] = useState(false);

  const [relations, setRelations] = useState<Array<any>>([]);
  const [projectCards, setProjectCards] = useState<
    Array<{ id: string; identifier: string; title: string }>
  >([]);
  const [selectedProjectCardId, setSelectedProjectCardId] = useState("");
  const [targetIdentifierInput, setTargetIdentifierInput] = useState("");
  const [relationTypeInput, setRelationTypeInput] = useState("BLOCKS");
  const [relationError, setRelationError] = useState("");
  const [isAddingRelation, setIsAddingRelation] = useState(false);

  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentContent, setCommentContent] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [links, setLinks] = useState<Array<any>>((card as any).links || []);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");

  const [attachments, setAttachments] = useState<Array<any>>((card as any).attachments || []);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  const [activities, setActivities] = useState<Array<any>>(card.activities || []);
  const [feedTab, setFeedTab] = useState<"comments" | "activity">("comments");
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);

  const { t } = useTranslation();

  async function loadActivities() {
    setIsLoadingActivities(true);
    const res = await getCardActivity(card.id);
    if (res.success && res.data) {
      setActivities(res.data);
    }
    setIsLoadingActivities(false);
  }

  async function loadRelations() {
    const res = await getCardRelations(card.id);
    if (res.success && res.data) {
      setRelations(res.data);
    }
  }

  useEffect(() => {
    async function fetchAttachments() {
      const res = await listAttachments(card.id);
      if (res.success && res.data) {
        setAttachments(res.data);
      }
    }
    fetchAttachments();
    loadActivities();
  }, [card.id]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAttachment(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const res = await uploadAttachment({
        cardId: card.id,
        filename: file.name,
        contentBuffer: buffer,
        mimeType: file.type || undefined,
      });

      if (res.success && res.data) {
        setAttachments((prev) => [res.data, ...prev]);
        onRefresh();
      }
    } catch (err) {
      console.error("Failed to upload attachment:", err);
    } finally {
      setIsUploadingAttachment(false);
      e.target.value = "";
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    const res = await deleteAttachment(attachmentId);
    if (res.success) {
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      onRefresh();
    }
  };

  useEffect(() => {
    async function loadLabels() {
      const res = await getLabels(card.projectId);
      if (res.success && res.data) {
        setAvailableLabels(res.data);
      }
    }
    async function loadCardTypes() {
      const res = await getCardTypes(card.projectId);
      if (res.success && res.data) {
        setAvailableCardTypes(res.data);
      }
    }
    async function loadProjectCards() {
      const pRes = await getProjectById(card.projectId);
      if (pRes.success && pRes.data && pRes.data.columns) {
        const key = pRes.data.key;
        const allCards = pRes.data.columns.flatMap((col: any) => col.cards || []);
        const otherCards = allCards
          .filter((c: any) => c.id !== card.id)
          .map((c: any) => ({
            id: c.id,
            identifier: `${key}-${c.number}`,
            title: c.title,
          }));
        setProjectCards(otherCards);
      }
    }

    loadLabels();
    loadCardTypes();
    loadRelations();
    loadProjectCards();

    setTitle(card.title);
    setDescription(card.description || "");
    setColumnId(card.columnId);
    setPriority(card.priority);
    setPoints(card.points !== null && card.points !== undefined ? String(card.points) : "");
    setOwner(card.owner || "");
    setDueDate(card.dueDate ? new Date(card.dueDate).toISOString().split("T")[0] : "");
    setSelectedLabelIds(card.labels ? card.labels.map((l) => l.label.id) : []);
    setTypeId(card.typeId || card.type?.id || "");
    setSubtasks(card.children || []);
    setParentCard(card.parent || null);
    setIsAddingSubtask(false);
    setNewSubtaskTitle("");
    setSubtaskError("");
  }, [card.id, card.projectId]);

  async function handleCreateSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || isSubmittingSubtask) return;

    setIsSubmittingSubtask(true);
    setSubtaskError("");

    const defaultColumnId = columns[0]?.id || card.columnId;
    const res = await createCard({
      projectId: card.projectId,
      columnId: defaultColumnId,
      title: newSubtaskTitle.trim(),
      parentId: card.id,
    });

    setIsSubmittingSubtask(false);

    if (res.success && res.data) {
      setSubtasks((prev) => [...prev, res.data]);
      setNewSubtaskTitle("");
      setIsAddingSubtask(false);
      onRefresh();
    } else {
      setSubtaskError(res.error || "Failed to create subtask");
    }
  }

  async function handleToggleSubtaskStatus(subtaskId: string, isCurrentlyDone: boolean) {
    setSubtaskLoadingId(subtaskId);
    const doneCol = columns.find((c) => c.isDone) || columns[columns.length - 1];
    const todoCol = columns.find((c) => !c.isDone) || columns[0];
    const targetCol = isCurrentlyDone ? todoCol : doneCol;

    if (!targetCol) {
      setSubtaskLoadingId(null);
      return;
    }

    const res = await updateCard(subtaskId, {
      columnId: targetCol.id,
    });

    setSubtaskLoadingId(null);

    if (res.success && res.data) {
      setSubtasks((prev) =>
        prev.map((s) =>
          s.id === subtaskId
            ? {
                ...s,
                columnId: targetCol.id,
                completedAt: targetCol.isDone ? new Date() : null,
                column: { id: targetCol.id, name: targetCol.name, isDone: targetCol.isDone },
              }
            : s
        )
      );
      onRefresh();
    }
  }

  async function handleDetachSubtask(subtaskId: string) {
    const res = await updateCard(subtaskId, {
      parentId: null,
    });
    if (res.success) {
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId));
      onRefresh();
    }
  }

  async function handleDetachParent() {
    const res = await updateCard(card.id, {
      parentId: null,
    });
    if (res.success) {
      setParentCard(null);
      onRefresh();
    }
  }

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
      typeId: typeId || "",
      labelIds: selectedLabelIds,
    });
    setIsSaving(false);

    if (res.success) {
      onRefresh();
    }
  }

  const [archiving, setArchiving] = useState(false);

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

  async function handleArchive() {
    if (!confirm("Are you sure you want to archive this card?")) return;
    setArchiving(true);
    const res = await archiveCard(card.id);
    setArchiving(false);

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
      loadActivities();
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

  async function handleAddRelation(e: React.FormEvent) {
    e.preventDefault();
    setRelationError("");

    let targetCardId = selectedProjectCardId;

    if (!targetCardId && targetIdentifierInput.trim()) {
      const targetLookup = await getCardByIdentifier(targetIdentifierInput.trim());
      if (targetLookup.success && targetLookup.data) {
        targetCardId = targetLookup.data.id;
      } else {
        setRelationError(`Card '${targetIdentifierInput.trim()}' not found`);
        return;
      }
    }

    if (!targetCardId) {
      setRelationError("Please select a card from the dropdown or enter an identifier");
      return;
    }

    const res = await addCardRelation(card.id, targetCardId, relationTypeInput);
    if (!res.success) {
      setRelationError(res.error || "Failed to add card relation");
      return;
    }

    setTargetIdentifierInput("");
    setSelectedProjectCardId("");
    setIsAddingRelation(false);
    loadRelations();
    onRefresh();
  }

  async function handleRemoveRelation(relationId: string) {
    const res = await removeCardRelation(relationId);
    if (res.success) {
      loadRelations();
      onRefresh();
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!newLinkUrl.trim()) return;

    let url = newLinkUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    const res = await addCardLink(card.id, url, newLinkTitle.trim() || undefined);
    if (res.success && res.data) {
      setLinks((prev) => [...prev, res.data]);
      setNewLinkUrl("");
      setNewLinkTitle("");
      setIsAddingLink(false);
      onRefresh();
    }
  }

  async function handleRemoveLink(linkId: string) {
    const res = await removeCardLink(linkId);
    if (res.success) {
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      onRefresh();
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
              onClick={handleArchive}
              disabled={archiving}
              className="rounded-lg p-2 text-slate-500 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              title="Archive task card"
            >
              <Archive className="h-4 w-4" />
            </button>
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

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Parent Card Breadcrumb */}
          {parentCard && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-800/50 text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <CornerDownRight className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">Subtask of:</span>
                <button
                  type="button"
                  onClick={() => onOpenCard?.(parentCard.id)}
                  className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline truncate"
                  title={parentCard.title}
                >
                  {parentCard.number ? `#${parentCard.number} ` : ""}{parentCard.title}
                </button>
              </div>
              <button
                type="button"
                onClick={handleDetachParent}
                className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 flex items-center gap-1 shrink-0 ml-2 transition-colors"
                title="Detach this subtask from its parent"
              >
                <Unlink className="h-3 w-3" />
                <span>Detach</span>
              </button>
            </div>
          )}

          {/* Title */}
          <div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/80 px-3.5 py-2.5 text-lg font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder={t("cardModal.cardTitlePlaceholder")}
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
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

              {/* Type Selector */}
              <div>
                <label className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    <CardTypeIcon
                      name={availableCardTypes.find((ct) => ct.id === typeId)?.icon}
                      className="h-3 w-3 text-indigo-500 dark:text-indigo-400"
                    />
                    <span>{t("cardModal.type")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsCardTypeModalOpen(true)}
                    className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 hover:underline"
                  >
                    {t("cardModal.manageTypes")}
                  </button>
                </label>
                <select
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                  className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  <option value="">{t("cardModal.noType")}</option>
                  {availableCardTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
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
                  <option value="NONE">{t("cardModal.priorityNone")}</option>
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
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder={t("cardModal.descriptionPlaceholder")}
              rows={4}
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

          {/* Subtasks Section */}
          {!parentCard && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Subtasks ({subtasks.filter((s) => s.completedAt || s.column?.isDone).length}/{subtasks.length})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingSubtask(!isAddingSubtask)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Subtask</span>
                </button>
              </div>

              {/* Progress Bar when subtasks exist */}
              {subtasks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    <span>
                      {subtasks.filter((s) => s.completedAt || s.column?.isDone).length} of {subtasks.length} completed
                    </span>
                    <span>
                      {Math.round(
                        (subtasks.filter((s) => s.completedAt || s.column?.isDone).length / subtasks.length) * 100
                      )}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                    <div
                      className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          (subtasks.filter((s) => s.completedAt || s.column?.isDone).length / subtasks.length) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Inline Add Subtask Form */}
              {isAddingSubtask && (
                <form onSubmit={handleCreateSubtask} className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="What needs to be done?..."
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      autoFocus
                      className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={isSubmittingSubtask || !newSubtaskTitle.trim()}
                      className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {isSubmittingSubtask ? "Adding..." : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingSubtask(false);
                        setNewSubtaskTitle("");
                        setSubtaskError("");
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {subtaskError && (
                    <p className="text-[11px] text-rose-500 font-semibold">{subtaskError}</p>
                  )}
                </form>
              )}

              {/* Subtasks List */}
              {subtasks.length > 0 && (
                <div className="space-y-1.5">
                  {subtasks.map((subtask) => {
                    const isDone = !!(subtask.completedAt || subtask.column?.isDone);
                    return (
                      <div
                        key={subtask.id}
                        className="group flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/60 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={subtaskLoadingId === subtask.id}
                            onClick={() => handleToggleSubtaskStatus(subtask.id, isDone)}
                            className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              isDone
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : "border-slate-300 dark:border-slate-600 hover:border-indigo-500 bg-white dark:bg-slate-900"
                            }`}
                          >
                            {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                          </button>

                          {subtask.number && (
                            <span className="font-mono text-[10px] text-slate-400 shrink-0">
                              #{subtask.number}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenCard?.(subtask.id)}
                            className={`truncate text-left font-medium hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${
                              isDone
                                ? "line-through text-slate-400 dark:text-slate-500"
                                : "text-slate-800 dark:text-slate-200"
                            }`}
                            title={subtask.title}
                          >
                            {subtask.title}
                          </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {subtask.column && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {subtask.column.name}
                            </span>
                          )}

                          {subtask.dueDate && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {new Date(subtask.dueDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDetachSubtask(subtask.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition-opacity"
                            title="Detach subtask from this card"
                          >
                            <Unlink className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Card Relations Dependencies Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Card Dependencies & Relations ({relations.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingRelation(!isAddingRelation)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Link Card</span>
              </button>
            </div>

            {/* Relation Form */}
            {isAddingRelation && (
              <form onSubmit={handleAddRelation} className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 space-y-2.5">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={relationTypeInput}
                    onChange={(e) => setRelationTypeInput(e.target.value)}
                    className="rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-semibold focus:outline-none shrink-0"
                  >
                    <option value="BLOCKS">Blocks</option>
                    <option value="BLOCKED_BY">Is Blocked By</option>
                    <option value="RELATES_TO">Relates To</option>
                  </select>

                  {/* Same-project Cards Dropdown */}
                  <select
                    value={selectedProjectCardId}
                    onChange={(e) => {
                      setSelectedProjectCardId(e.target.value);
                      if (e.target.value) setTargetIdentifierInput("");
                    }}
                    className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="">-- Select card from this project --</option>
                    {projectCards.map((pc) => (
                      <option key={pc.id} value={pc.id}>
                        [{pc.identifier}] {pc.title}
                      </option>
                    ))}
                  </select>

                  <button
                    type="submit"
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shrink-0"
                  >
                    Add
                  </button>
                </div>

                {/* Free Text Identifier Input */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-700/50">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium shrink-0">Or type identifier / ID:</span>
                  <input
                    type="text"
                    placeholder="e.g. OPMR-2 or card ID..."
                    value={targetIdentifierInput}
                    onChange={(e) => {
                      setTargetIdentifierInput(e.target.value);
                      if (e.target.value) setSelectedProjectCardId("");
                    }}
                    className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>

                {relationError && (
                  <p className="text-[11px] text-red-500 font-semibold">{relationError}</p>
                )}
              </form>
            )}

            {/* Relations List */}
            <div className="flex flex-wrap gap-2">
              {relations.length > 0 ? (
                relations.map((rel) => {
                  const isBlocked = rel.relationType === "BLOCKED_BY" && !rel.isDone;
                  return (
                    <div
                      key={rel.id}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                        isBlocked
                          ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                          : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {isBlocked ? (
                        <ShieldAlert className="h-3.5 w-3.5 text-rose-500 animate-pulse" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5 text-indigo-500" />
                      )}
                      <span className="uppercase text-[10px] font-bold tracking-wider opacity-75">
                        {rel.relationType.replace("_", " ")}
                      </span>
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {rel.identifier}
                      </span>
                      <span className="max-w-[140px] truncate text-slate-600 dark:text-slate-400">
                        ({rel.cardTitle})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRelation(rel.id)}
                        className="ml-1 rounded text-slate-400 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                  No linked cards or dependencies.
                </p>
              )}
            </div>
          </div>

          {/* External Links Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  External Links ({links.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingLink(!isAddingLink)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Link</span>
              </button>
            </div>

            {isAddingLink && (
              <form onSubmit={handleAddLink} className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    required
                    placeholder="https://..."
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    className="flex-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Title (optional)"
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    className="w-1/3 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1.5">
              {links.length > 0 ? (
                links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:underline truncate"
                    >
                      <Link2 className="h-3 w-3 shrink-0" />
                      <span className="truncate font-medium">{link.title || link.url}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(link.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                      title="Remove link"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                  No external links added.
                </p>
              )}
            </div>
          </div>

          {/* File Attachments Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Attachments ({attachments.length})
                </h4>
              </div>
              <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                <Plus className="h-3 w-3" />
                <span>Upload File</span>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={isUploadingAttachment}
                  className="hidden"
                />
              </label>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {attachments && attachments.length > 0 ? (
                attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-slate-800 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 truncate max-w-[80%]"
                    >
                      <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate font-medium">{att.filename}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({Math.round(att.size / 1024)} KB)
                      </span>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteAttachment(att.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                      title="Delete attachment"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                  No file attachments yet.
                </p>
              )}
            </div>
          </div>

          {/* Comments & Activity Log Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            {/* Feed Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFeedTab("comments")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    feedTab === "comments"
                      ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{t("cardModal.tabComments")}</span>
                  <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-700 dark:text-slate-300">
                    {card.comments ? card.comments.length : 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFeedTab("activity")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    feedTab === "activity"
                      ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  <span>{t("cardModal.tabActivity")}</span>
                  <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-700 dark:text-slate-300">
                    {activities.length}
                  </span>
                </button>
              </div>
            </div>

            {feedTab === "comments" ? (
              <>
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
              </>
            ) : (
              /* Activity Feed List */
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {isLoadingActivities ? (
                  <p className="text-xs text-slate-400 italic text-center py-4">
                    Loading activity...
                  </p>
                ) : activities && activities.length > 0 ? (
                  activities.map((act) => {
                    return (
                      <div
                        key={act.id}
                        className="flex items-start gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 p-2.5 border border-slate-200/80 dark:border-slate-800 text-xs"
                      >
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200/70 dark:bg-slate-700/70">
                          {act.type === "card_created" ? (
                            <Plus className="h-3 w-3 text-emerald-500" />
                          ) : act.type === "moved" ? (
                            <ArrowRight className="h-3 w-3 text-blue-500" />
                          ) : act.type === "priority_changed" ? (
                            <Zap className="h-3 w-3 text-amber-500" />
                          ) : act.type === "title_changed" || act.type === "description_changed" ? (
                            <Pencil className="h-3 w-3 text-indigo-500" />
                          ) : act.type === "points_changed" ? (
                            <Sparkles className="h-3 w-3 text-violet-500" />
                          ) : act.type === "due_date_changed" ? (
                            <Calendar className="h-3 w-3 text-cyan-500" />
                          ) : act.type === "type_changed" ? (
                            <Layers className="h-3 w-3 text-indigo-400" />
                          ) : act.type === "label_added" || act.type === "label_removed" ? (
                            <Tag className="h-3 w-3 text-pink-500" />
                          ) : act.type === "assigned" || act.type === "unassigned" ? (
                            <User className="h-3 w-3 text-purple-500" />
                          ) : act.type === "comment_added" ? (
                            <MessageSquare className="h-3 w-3 text-blue-400" />
                          ) : act.type === "archived" || act.type === "unarchived" ? (
                            <Archive className="h-3 w-3 text-amber-500" />
                          ) : (
                            <ActivityIcon className="h-3 w-3 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 space-y-0.5 min-w-0">
                          <p className="text-slate-800 dark:text-slate-200 leading-snug">
                            {act.type === "card_created" && "Card created"}
                            {act.type === "moved" &&
                              (act.fromValue && act.toValue
                                ? `Moved from "${act.fromValue}" to "${act.toValue}"`
                                : `Moved to "${act.toValue || ""}"`)}
                            {act.type === "priority_changed" &&
                              `Priority changed from ${act.fromValue || "NONE"} to ${act.toValue || "NONE"}`}
                            {act.type === "title_changed" && `Title changed to "${act.toValue}"`}
                            {act.type === "description_changed" && "Updated description"}
                            {act.type === "points_changed" &&
                              (act.toValue ? `Points set to ${act.toValue}` : "Cleared points")}
                            {act.type === "due_date_changed" &&
                              (act.toValue ? `Due date set to ${act.toValue}` : "Removed due date")}
                            {act.type === "type_changed" &&
                              (act.toValue ? `Card type changed to "${act.toValue}"` : "Removed card type")}
                            {act.type === "label_added" && `Added label "${act.toValue}"`}
                            {act.type === "label_removed" && `Removed label "${act.fromValue}"`}
                            {act.type === "assigned" && `Assigned to ${act.toValue}`}
                            {act.type === "unassigned" && `Unassigned ${act.fromValue}`}
                            {act.type === "comment_added" && "Added a comment"}
                            {act.type === "archived" && "Archived card"}
                            {act.type === "unarchived" && "Restored card from archive"}
                            {![
                              "card_created",
                              "moved",
                              "priority_changed",
                              "title_changed",
                              "description_changed",
                              "points_changed",
                              "due_date_changed",
                              "type_changed",
                              "label_added",
                              "label_removed",
                              "assigned",
                              "unassigned",
                              "comment_added",
                              "archived",
                              "unarchived",
                            ].includes(act.type) && act.type}
                          </p>
                          <span className="text-[10px] text-slate-400 block">
                            {new Date(act.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 italic text-center py-4">
                    {t("cardModal.noActivity")}
                  </p>
                )}
              </div>
            )}
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

      {isCardTypeModalOpen && (
        <CardTypeManagerModal
          projectId={card.projectId}
          onClose={() => setIsCardTypeModalOpen(false)}
          onChange={async () => {
            const res = await getCardTypes(card.projectId);
            if (res.success && res.data) {
              setAvailableCardTypes(res.data);
            }
          }}
        />
      )}
    </div>
  );
}
