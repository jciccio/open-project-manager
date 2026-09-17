"use client";

import { useState } from "react";
import { LogIn, Key, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { loginUser } from "@/actions/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/components/LanguageProvider";
import type { TranslationKeys } from "@/locales/en";

const OIDC_ERROR_KEYS: Record<string, keyof TranslationKeys["auth"]> = {
  oidc_session_expired: "oidcErrorSessionExpired",
  oidc_missing_email: "oidcErrorMissingEmail",
  oidc_email_not_verified: "oidcErrorEmailNotVerified",
  oidc_failed: "oidcErrorFailed",
};

export function LoginForm({ oidcEnabled }: { oidcEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const oidcErrorCode = searchParams.get("error");
  const oidcErrorKey = oidcErrorCode ? OIDC_ERROR_KEYS[oidcErrorCode] : undefined;
  const displayedError = error || (oidcErrorKey ? t(`auth.${oidcErrorKey}`) : "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError(t("auth.fillAllFields"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await loginUser({ email, password });
      if (res.success) {
        window.location.href = "/";
      } else {
        setLoading(false);
        setError(res.error || "Invalid credentials");
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "An unexpected login error occurred. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 shadow-2xl space-y-6">
        {/* Brand Logo */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-indigo-600 to-purple-600 p-0.5 shadow-lg shadow-amber-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-slate-950 overflow-hidden">
              <Image src="/logo.png" alt="Nanobanana Logo" width={40} height={40} unoptimized className="h-10 w-10 object-cover rounded-xl" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t("header.title")}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t("auth.signIn")}
            </p>
          </div>
        </div>

        {displayedError && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3.5 text-xs font-semibold text-red-600 dark:text-red-400 text-center">
            {displayedError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("auth.emailLabel")}
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("auth.passwordLabel")}
            </label>
            <div className="relative">
              <Key className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all mt-2"
          >
            <LogIn className="h-4 w-4" />
            <span>{loading ? t("auth.signingIn") : t("auth.signIn")}</span>
          </button>
        </form>

        {oidcEnabled && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                {t("auth.orContinueWith")}
              </span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>
            <a
              href="/api/v1/auth/oidc/login"
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{t("auth.signInWithSso")}</span>
            </a>
          </>
        )}

        {/* Register Link */}
        <div className="text-center pt-2 border-t border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("auth.noAccount")}{" "}
            <Link
              href="/register"
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {t("auth.createOneNow")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
