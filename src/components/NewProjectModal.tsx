"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { createProject } from "@/actions/projects";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";
import ColorPicker from "./ColorPicker";
import { DEFAULT_PROJECT_COLOR } from "@/lib/colors";
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, ModalDismissButton } from "./Modal";
import ErrorBanner from "./ErrorBanner";

interface Props {
  onClose: () => void;
}

export default function NewProjectModal({ onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();
  const router = useRouter();
  const isDirty = name.trim() !== "" || description.trim() !== "";
  const handleGuardedClose = () => {
    if (isDirty && !confirm(t("cardModal.confirmDiscard"))) {
      return;
    }
    onClose();
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("newProjectModal.nameRequired"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await createProject({ name, description, color });
      setLoading(false);

      if (res.success && res.data) {
        onClose();
        router.push(`/projects/${res.data.id}`);
      } else {
        const errorMsg =
          res.error === "Project name is required"
            ? t("newProjectModal.nameRequired")
            : t("newProjectModal.failedToCreate");
        setError(errorMsg);
      }
    } catch {
      setLoading(false);
      setError(t("newProjectModal.failedToCreate"));
    }
  }

  return (
    <Modal labelledBy="new-project-title" onBackdropClick={handleGuardedClose} onEscape={handleGuardedClose}>
        <ModalHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <FolderPlus className="h-5 w-5" />
            </div>
            <h3 id="new-project-title" className="text-lg font-bold text-slate-900 dark:text-white">
              {t("newProjectModal.title")}
            </h3>
          </div>
          <ModalCloseButton onClick={handleGuardedClose} label={t("cardModal.close")} />
        </ModalHeader>

        <ModalBody className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <form id="new-project-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-project-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("newProjectModal.nameLabel")} <span className="text-red-500">*</span>
            </label>
            <input
              id="new-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("newProjectModal.namePlaceholder")}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="new-project-desc" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("newProjectModal.descLabel")}
            </label>
            <textarea
              id="new-project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("newProjectModal.descPlaceholder")}
              rows={3}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <ColorPicker
            value={color}
            onChange={setColor}
            label={t("newProjectModal.colorLabel")}
          />

        </form>
        </ModalBody>

        <ModalFooter>
          <ModalDismissButton onClick={handleGuardedClose}>{t("kanban.cancel")}</ModalDismissButton>
          <button
            type="submit"
            form="new-project-form"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-all shadow-md shadow-indigo-600/20"
          >
            {loading ? t("newProjectModal.creating") : t("newProjectModal.create")}
          </button>
        </ModalFooter>
    </Modal>
  );
}
