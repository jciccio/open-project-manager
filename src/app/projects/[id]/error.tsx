"use client";

import PageError from "@/components/PageError";
import { useTranslation } from "@/components/LanguageProvider";

export default function ProjectBoardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useTranslation();
  return <PageError title={t("errorPage.boardTitle")} message={t("errorPage.boardMessage")} retry={retry} />;
}
