"use client";

import { useEffect, useState } from "react";
import { X, Tag, Plus, Trash2 } from "lucide-react";
import { getLabels, createLabel, deleteLabel } from "@/actions/labels";
import { useTranslation } from "./LanguageProvider";

interface Props {
  onClose: () => void;
}

const PRESET_COLORS = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#ec4899", // Pink
];

export default function LabelManagerModal({ onClose }: Props) {
  const [labels, setLabels] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    fetchLabels();
  }, []);

  async function fetchLabels() {
    const res = await getLabels();
    if (res.success && res.data) {
      setLabels(res.data);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    const res = await createLabel(name.trim(), color);
    setLoading(false);

    if (res.success) {
      setName("");
      fetchLabels();
    }
  }

  async function handleDelete(id: string) {
    const res = await deleteLabel(id);
    if (res.success) {
      fetchLabels();
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

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("labelModal.color")}</span>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full transition-transform ${
                    color === c ? "scale-125 ring-2 ring-indigo-500" : "opacity-70 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </form>

        {/* Existing Labels */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("labelModal.existing")}</h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {labels.length > 0 ? (
              labels.map((lbl) => (
                <div
                  key={lbl.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <span
                    className="rounded-md px-2.5 py-0.5 font-bold text-white shadow-2xs"
                    style={{ backgroundColor: lbl.color }}
                  >
                    {lbl.name}
                  </span>
                  <button
                    onClick={() => handleDelete(lbl.id)}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
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
