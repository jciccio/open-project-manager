"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { useTranslation } from "./LanguageProvider";

interface Props {
  title: string;
  message: string;
  retry: () => void;
}

export default function PageError({ title, message, retry }: Props) {
  const { t } = useTranslation();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            <span>{t("errorPage.tryAgain")}</span>
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{t("errorPage.backToProjects")}</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
