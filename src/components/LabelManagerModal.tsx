"use client";

import { useEffect, useState } from "react";
import { X, Tag, Plus, Trash2, Pencil } from "lucide-react";
import { getLabels, createLabel, deleteLabel, updateLabel } from "@/actions/labels";
import { useTranslation } from "./LanguageProvider";
import ColorPicker from "./ColorPicker";
import ErrorBanner from "./ErrorBanner";
import { DEFAULT_PROJECT_COLOR } from "@/lib/colors";

interface Props {
  onClose: () => void;
}

export default function LabelManagerModal({ onClose }: Props) {
  const [labels, setLabels] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editColor, setEditColor] = useState(DEFAULT_PROJECT_COLOR);
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    fetchLabels();
  }, []);

  async function fetchLabels() {
    try {
      const res = await getLabels();
      if (res.success && res.data) {
        setLabels(res.data);
      }
    } catch {
      setError("Failed to load labels.");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");
    try {
      const res = await createLabel(name.trim(), color, undefined, description);
      if (res.success) {
        setName("");
        setDescription("");
        await fetchLabels();
      } else {
        setError(res.error || "Failed to create label.");
      }
    } catch {
      setError("Failed to create label.");
    } finally {
      setLoading(false);
    }
  }

  function startEditing(label: { id: string; color: string; description?: string | null }) {
    setEditingId(label.id);
    setEditColor(label.color);
    setEditDescription(label.description ?? "");
    setError("");
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;

    setSavingEdit(true);
    setError("");
    try {
      const res = await updateLabel(editingId, { color: editColor, description: editDescription });
      if (res.success) {
        setEditingId(null);
        await fetchLabels();
      } else {
        setError(res.error || "Failed to update label.");
      }
    } catch {
      setError("Failed to update label.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError("");
    try {
      const res = await deleteLabel(id);
      if (res.success) {
        await fetchLabels();
      } else {
        setError(res.error || "Failed to delete label.");
      }
    } catch {
      setError("Failed to delete label.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <Tag className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t("labelModal.title")}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Create Form */}
        <form onSubmit={handleCreate} className="space-y-3 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("labelModal.addNew")}</h4>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("labelModal.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t("kanban.create")}</span>
            </button>
          </div>

          <ColorPicker
            value={color}
            onChange={setColor}
            label={t("labelModal.color")}
            size="sm"
          />

          <textarea
            aria-label={t("labelModal.description")}
            placeholder={t("labelModal.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </form>

        {/* Existing Labels */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("labelModal.existing")}</h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {labels.length > 0 ? (
              labels.map((lbl) =>
                editingId === lbl.id ? (
                  <form
                    key={lbl.id}
                    onSubmit={handleSaveEdit}
                    aria-label={t("labelModal.editLabel")}
                    className="space-y-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-indigo-500/40 px-3 py-2 text-xs"
                  >
                    <span
                      className="inline-block rounded-md px-2.5 py-0.5 font-bold text-white shadow-2xs"
                      style={{ backgroundColor: editColor }}
                    >
                      {lbl.name}
                    </span>
                    <ColorPicker value={editColor} onChange={setEditColor} label={t("labelModal.color")} size="sm" />
                    <textarea
                      aria-label={t("labelModal.description")}
                      placeholder={t("labelModal.descriptionPlaceholder")}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      >
                        {t("labelModal.cancel")}
                      </button>
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {savingEdit ? t("labelModal.saving") : t("labelModal.save")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    key={lbl.id}
                    className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <span
                        className="inline-block rounded-md px-2.5 py-0.5 font-bold text-white shadow-2xs"
                        style={{ backgroundColor: lbl.color }}
                      >
                        {lbl.name}
                      </span>
                      {lbl.description && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-line break-words">
                          {lbl.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        onClick={() => startEditing(lbl)}
                        className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                        title={t("labelModal.editLabel")}
                        aria-label={t("labelModal.editLabel")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(lbl.id)}
                        disabled={deletingId === lbl.id}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                        title={t("labelModal.deleteLabel")}
                        aria-label={t("labelModal.deleteLabel")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              )
            ) : (
              <p className="text-xs text-slate-400 italic">{t("labelModal.noLabels")}</p>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            {t("labelModal.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
