"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus, Tag, LogOut, Archive, Sun, Moon, Globe, User as UserIcon } from "lucide-react";
import { useState } from "react";
import NewProjectModal from "./NewProjectModal";
import LabelManagerModal from "./LabelManagerModal";
import UserProfileModal from "./UserProfileModal";
import { logoutUser } from "@/actions/auth";
import { useRouter } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useTranslation } from "./LanguageProvider";

interface Props {
  user?: {
    userId: string;
    email: string;
    name: string;
  } | null;
  archivedCount?: number;
}

export default function Header({ user, archivedCount = 0 }: Props) {
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useTranslation();
  const router = useRouter();

  async function handleLogout() {
    setLoggingOut(true);
    await logoutUser();
    window.location.href = "/login";
  }

  function toggleLanguage() {
    setLocale(locale === "en" ? "es" : "en");
  }

  return (
    <>
      <header className="sticky top-0 z-30 w-full glass-panel border-b border-slate-200 dark:border-slate-800 px-6 py-3.5">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          {/* Logo & Brand */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-indigo-600 to-purple-600 p-0.5 shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950 overflow-hidden">
                <Image src="/logo.png" alt="Nanobanana Logo" width={32} height={32} unoptimized className="h-8 w-8 object-cover rounded-lg" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-700 dark:from-white dark:via-slate-200 dark:to-indigo-300 bg-clip-text text-transparent">
                  {t("header.title")}
                </span>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  {t("header.badge")}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t("header.subtitle")}</p>
            </div>
          </Link>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-2.5">
            {/* Language Selector Button */}
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 px-2.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all border border-slate-300 dark:border-slate-700"
              title="Switch Language (EN / ES)"
            >
              <Globe className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="uppercase">{locale}</span>
            </button>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center rounded-lg bg-slate-200/80 dark:bg-slate-800/80 p-2 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all border border-slate-300 dark:border-slate-700"
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-indigo-600" />
              )}
            </button>

            <Link
              href="/archived"
              className="flex items-center gap-2 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all border border-slate-300 dark:border-slate-700 relative"
              title="View Archived Projects"
            >
              <Archive className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="hidden sm:inline">{t("header.archived")}</span>
              {archivedCount > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-400 border border-amber-500/30">
                  {archivedCount}
                </span>
              )}
            </Link>

            <button
              onClick={() => setIsLabelModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all border border-slate-300 dark:border-slate-700"
            >
              <Tag className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="hidden sm:inline">{t("header.labels")}</span>
            </button>

            <button
              onClick={() => setIsProjectModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>{t("header.newProject")}</span>
            </button>

            {user && (
              <div className="pl-2 border-l border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
                <button
                  onClick={() => setIsProfileModalOpen(true)}
                  className="flex items-center gap-2 rounded-lg bg-slate-200/80 dark:bg-slate-800/80 p-1.5 pr-3 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all border border-slate-300 dark:border-slate-700 text-left"
                  title={t("header.profile")}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xs shadow-xs">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden md:inline font-bold text-xs text-slate-900 dark:text-white truncate max-w-[100px]">
                    {user.name}
                  </span>
                </button>

                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                  title={t("header.logout")}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isProjectModalOpen && (
        <NewProjectModal onClose={() => setIsProjectModalOpen(false)} />
      )}

      {isLabelModalOpen && (
        <LabelManagerModal onClose={() => setIsLabelModalOpen(false)} />
      )}

      {isProfileModalOpen && user && (
        <UserProfileModal user={user} onClose={() => setIsProfileModalOpen(false)} />
      )}
    </>
  );
}
