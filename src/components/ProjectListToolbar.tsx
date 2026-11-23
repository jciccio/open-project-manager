"use client";

import { Search } from "lucide-react";
import { useTranslation } from "./LanguageProvider";
import {
  PROJECT_ROLE_FILTERS,
  PROJECT_SORTS,
  PROJECT_VISIBILITY_FILTERS,
  type ProjectListQuery,
} from "@/lib/projectListFilter";

const ROLE_LABELS: Record<ProjectListQuery["role"], string> = {
  all: "dashboard.roleAll",
  owned: "dashboard.roleOwned",
  shared: "dashboard.roleShared",
};

const VISIBILITY_LABELS: Record<ProjectListQuery["visibility"], string> = {
  all: "dashboard.visibilityAll",
  PRIVATE: "dashboard.visibilityPrivate",
  INTERNAL: "dashboard.visibilityInternal",
};

const SORT_LABELS: Record<ProjectListQuery["sort"], string> = {
  newest: "dashboard.sortNewest",
  oldest: "dashboard.sortOldest",
  nameAsc: "dashboard.sortNameAsc",
  nameDesc: "dashboard.sortNameDesc",
  mostOpen: "dashboard.sortMostOpen",
  mostOverdue: "dashboard.sortMostOverdue",
  completion: "dashboard.sortCompletion",
};

const SELECT_CLASS =
  "rounded-lg bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white cursor-pointer focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const LABEL_CLASS = "text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400";

interface Props {
  query: ProjectListQuery;
  onChange: (query: ProjectListQuery) => void;
}

export default function ProjectListToolbar({ query, onChange }: Props) {
  const { t } = useTranslation();
  const update = (patch: Partial<ProjectListQuery>) => onChange({ ...query, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6" role="search" aria-label={t("dashboard.searchLabel")}>
      <label className="flex flex-col gap-1 grow sm:grow-0">
        <span className={LABEL_CLASS}>{t("dashboard.searchLabel")}</span>
        <span className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query.search}
            placeholder={t("dashboard.searchPlaceholder")}
            onChange={(e) => update({ search: e.target.value })}
            className="w-full sm:w-56 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>{t("dashboard.roleLabel")}</span>
        <select
          value={query.role}
          onChange={(e) => update({ role: e.target.value as ProjectListQuery["role"] })}
          className={SELECT_CLASS}
        >
          {PROJECT_ROLE_FILTERS.map((role) => (
            <option key={role} value={role}>
              {t(ROLE_LABELS[role])}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>{t("dashboard.visibilityLabel")}</span>
        <select
          value={query.visibility}
          onChange={(e) => update({ visibility: e.target.value as ProjectListQuery["visibility"] })}
          className={SELECT_CLASS}
        >
          {PROJECT_VISIBILITY_FILTERS.map((visibility) => (
            <option key={visibility} value={visibility}>
              {t(VISIBILITY_LABELS[visibility])}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 sm:ml-auto">
        <span className={LABEL_CLASS}>{t("dashboard.sortLabel")}</span>
        <select
          value={query.sort}
          onChange={(e) => update({ sort: e.target.value as ProjectListQuery["sort"] })}
          className={SELECT_CLASS}
        >
          {PROJECT_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABELS[sort])}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
