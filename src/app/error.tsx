"use client";

import PageError from "@/components/PageError";
import { useTranslation } from "@/components/LanguageProvider";

export default function RootError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <PageError title={t("errorPage.pageTitle")} message={t("errorPage.pageMessage")} retry={retry} />
    </div>
  );
}
