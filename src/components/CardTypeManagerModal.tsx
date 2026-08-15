"use client";

import { useEffect, useState } from "react";
import { X, Layers, Plus, Trash2, Pencil, Check } from "lucide-react";
import { getCardTypes, createCardType, updateCardType, deleteCardType } from "@/actions/cardTypes";
import { useTranslation } from "./LanguageProvider";
import { CARD_TYPE_ICON_NAMES, CardTypeIcon } from "./cardTypeIcons";

interface Props {
  projectId: string;
  onClose: () => void;
  onChange?: () => void;
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

interface CardTypeRecord {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export default function CardTypeManagerModal({ projectId, onClose, onChange }: Props) {
  const [cardTypes, setCardTypes] = useState<CardTypeRecord[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(CARD_TYPE_ICON_NAMES[0]);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingIcon, setEditingIcon] = useState("");
  const [editingColor, setEditingColor] = useState("");

  const { t } = useTranslation();

  useEffect(() => {
    fetchCardTypes();
  }, [projectId]);

  async function fetchCardTypes() {
    const res = await getCardTypes(projectId);
    if (res.success && res.data) {
      setCardTypes(res.data);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    const res = await createCardType(name.trim(), projectId, icon, color);
    setLoading(false);

    if (res.success) {
      setName("");
      fetchCardTypes();
      onChange?.();
    }
  }

  async function handleDelete(id: string) {
    const res = await deleteCardType(id);
    if (res.success) {
      fetchCardTypes();
      onChange?.();
    }
  }

  function startEditing(ct: CardTypeRecord) {
    setEditingId(ct.id);
    setEditingName(ct.name);
    setEditingIcon(ct.icon);
    setEditingColor(ct.color);
  }

  async function handleSaveEdit(id: string) {
    if (!editingName.trim()) return;
    const res = await updateCardType(id, { name: editingName.trim(), icon: editingIcon, color: editingColor });
    if (res.success) {
      setEditingId(null);
      fetchCardTypes();
      onChange?.();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t("cardTypeModal.title")}</h3>
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
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("cardTypeModal.addNew")}</h4>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("cardTypeModal.namePlaceholder")}
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
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("cardTypeModal.icon")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {CARD_TYPE_ICON_NAMES.map((iconName) => (
                <button
                  type="button"
                  key={iconName}
                  onClick={() => setIcon(iconName)}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                    icon === iconName
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                  title={iconName}
                >
                  <CardTypeIcon name={iconName} className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("cardTypeModal.color")}</span>
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

        {/* Existing Card Types */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t("cardTypeModal.existing")}</h4>
          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {cardTypes.length > 0 ? (
              cardTypes.map((ct) => {
                const isEditing = editingId === ct.id;
                return (
                  <div
                    key={ct.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                  >
                    {isEditing ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="flex-1 rounded-md bg-white dark:bg-slate-900 border border-indigo-500 px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-1">
                          {PRESET_COLORS.map((c) => (
                            <button
                              type="button"
                              key={c}
                              onClick={() => setEditingColor(c)}
                              className={`h-4 w-4 rounded-full transition-transform ${
                                editingColor === c ? "scale-125 ring-2 ring-indigo-500" : "opacity-70 hover:opacity-100"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(ct.id)}
                          className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-md"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-bold text-white shadow-2xs"
                          style={{ backgroundColor: ct.color }}
                        >
                          <CardTypeIcon name={ct.icon} className="h-3 w-3" />
                          {ct.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditing(ct)}
                            className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(ct.id)}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400 italic">{t("cardTypeModal.noTypes")}</p>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            {t("cardTypeModal.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
