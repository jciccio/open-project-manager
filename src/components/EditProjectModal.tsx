"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { updateProject } from "@/actions/projects";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";
import ColorPicker from "./ColorPicker";
import { DEFAULT_PROJECT_COLOR } from "@/lib/colors";
import ErrorBanner from "./ErrorBanner";
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, ModalDismissButton } from "./Modal";

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
        description: description.trim() || null,
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
        const errorMsg =
          res.error === "Project name is required"
            ? t("editProjectModal.nameRequired")
            : t("editProjectModal.failedToUpdate");
        setError(errorMsg);
      }
    } catch {
      setLoading(false);
      setError(t("editProjectModal.failedToUpdate"));
    }
  }

  return (
    <Modal labelledBy="edit-project-title">
        <ModalHeader>
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
            <h3 id="edit-project-title" className="text-lg font-bold text-slate-900 dark:text-white">
              {t("editProjectModal.title")}
            </h3>
          </div>
          <ModalCloseButton onClick={onClose} label={t("cardModal.close")} />
        </ModalHeader>

        <ModalBody className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <form id="edit-project-form" onSubmit={handleSubmit} className="space-y-4">
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

        </form>
        </ModalBody>

        <ModalFooter>
          <ModalDismissButton onClick={onClose}>{t("kanban.cancel")}</ModalDismissButton>
          <button
            type="submit"
            form="edit-project-form"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
          >
            {loading ? t("editProjectModal.saving") : t("editProjectModal.save")}
          </button>
        </ModalFooter>
    </Modal>
  );
}
