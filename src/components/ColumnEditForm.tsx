"use client";

import { useState } from "react";
import { updateColumn } from "@/actions/columns";
import { COLUMN_GROUPS, type ColumnGroup } from "@/lib/columnGroups";
import { useTranslation } from "./LanguageProvider";
import ErrorBanner from "./ErrorBanner";

const FALLBACK_PICKER_COLOR = "#6366f1";

interface Props {
  column: {
    id: string;
    name: string;
    group?: string | null;
    isDone?: boolean;
    color?: string | null;
    description?: string | null;
  };
  onSaved: () => void;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none";
const labelClass = "block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1";

export default function ColumnEditForm({ column, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(column.name);
  const [group, setGroup] = useState<ColumnGroup>(
    (COLUMN_GROUPS as readonly string[]).includes(column.group ?? "")
      ? (column.group as ColumnGroup)
      : column.isDone
        ? "COMPLETED"
        : "UNSTARTED"
  );
  const [color, setColor] = useState<string | null>(column.color ?? null);
  const [description, setDescription] = useState(column.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await updateColumn(column.id, {
        name,
        group,
        color,
        description: description.trim() || null,
      });
      if (res.success) {
        onSaved();
      } else {
        setError(res.error || "Failed to update column.");
      }
    } catch {
      setError("Failed to update column.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("kanban.editColumn")}
      className="mb-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-indigo-500/30 p-3 space-y-2.5 shadow-lg"
    >
      {error && <ErrorBanner message={error} />}

      <div>
        <label htmlFor={`column-name-${column.id}`} className={labelClass}>
          {t("kanban.columnName")}
        </label>
        <input
          id={`column-name-${column.id}`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor={`column-group-${column.id}`} className={labelClass}>
          {t("kanban.columnGroup")}
        </label>
        <select
          id={`column-group-${column.id}`}
          value={group}
          onChange={(e) => setGroup(e.target.value as ColumnGroup)}
          className={inputClass}
        >
          {COLUMN_GROUPS.map((value) => (
            <option key={value} value={value}>
              {t(`kanban.columnGroups.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`column-color-${column.id}`} className={labelClass}>
          {t("kanban.columnColor")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`column-color-${column.id}`}
            type="color"
            value={color ?? FALLBACK_PICKER_COLOR}
            onChange={(e) => setColor(e.target.value)}
            className={`h-7 w-10 cursor-pointer rounded border border-slate-300 dark:border-slate-700 bg-transparent ${color === null ? "opacity-30" : ""}`}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={color === null} onChange={(e) => setColor(e.target.checked ? null : FALLBACK_PICKER_COLOR)} />
            {t("kanban.clearColor")}
          </label>
        </div>
      </div>

      <div>
        <label htmlFor={`column-description-${column.id}`} className={labelClass}>
          {t("kanban.columnDescription")}
        </label>
        <textarea
          id={`column-description-${column.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("kanban.columnDescriptionPlaceholder")}
          rows={2}
          className={inputClass}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          {t("kanban.cancel")}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? t("kanban.saving") : t("kanban.save")}
        </button>
      </div>
    </form>
  );
}
