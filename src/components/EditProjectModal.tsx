"use client";

import { useState } from "react";
import { X, Pencil } from "lucide-react";
import { updateProject } from "@/actions/projects";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";
import ColorPicker from "./ColorPicker";
import { DEFAULT_PROJECT_COLOR } from "@/lib/colors";

interface Props {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: string;
  };
  onClose: () => void;
  onUpdateSuccess?: (updated: any) => void;
}

export default function EditProjectModal({ project, onClose, onUpdateSuccess }: Props) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [color, setColor] = useState(project.color || DEFAULT_PROJECT_COLOR);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("editProjectModal.nameRequired"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        color,
      });
      setLoading(false);

      if (res.success && res.data) {
        if (onUpdateSuccess) {
          onUpdateSuccess(res.data);
        } else {
          router.refresh();
        }
        onClose();
      } else {
        setError(res.error || "Failed to update project");
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Failed to update project");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg border"
              style={{
                backgroundColor: `${color}15`,
                borderColor: `${color}30`,
                color: color,
              }}
            >
              <Pencil className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {t("editProjectModal.title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-500 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("editProjectModal.nameLabel")} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("editProjectModal.namePlaceholder")}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("editProjectModal.descLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("editProjectModal.descPlaceholder")}
              rows={3}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <ColorPicker
            value={color}
            onChange={setColor}
            label={t("editProjectModal.colorLabel")}
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {t("kanban.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
            >
              {loading ? t("editProjectModal.saving") : t("editProjectModal.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
