"use client";

import { useEffect, useState } from "react";
import { X, User, Mail, Lock, CheckCircle2, Key, Copy, Eye, EyeOff, Check, Trash2 } from "lucide-react";
import { updateUserProfile, listApiTokens, createApiToken, revokeApiToken } from "@/actions/auth";
import { useRouter } from "next/navigation";
import { useTranslation } from "./LanguageProvider";

interface Props {
  user: {
    userId: string;
    email: string;
    name: string;
  };
  onClose: () => void;
}

interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export default function UserProfileModal({ user, onClose }: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedHeader, setCopiedHeader] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    listApiTokens().then((res) => {
      if (res.success && res.tokens) setTokens(res.tokens);
    });
  }, []);

  async function handleGenerateToken() {
    if (!newTokenName.trim()) return;
    setTokenLoading(true);
    const res = await createApiToken(newTokenName.trim());
    setTokenLoading(false);
    if (res.success && res.token) {
      setApiToken(res.token.secret);
      setNewTokenName("");
      setShowToken(false);
      const listRes = await listApiTokens();
      if (listRes.success && listRes.tokens) setTokens(listRes.tokens);
    }
  }

  async function handleRevokeToken(token: ApiTokenSummary) {
    if (!confirm(t("profileModal.confirmRevokeToken", { name: token.name }))) return;
    const res = await revokeApiToken(token.id);
    if (res.success) {
      setTokens((prev) => prev.filter((t) => t.id !== token.id));
    }
  }

  function handleCopyToken() {
    if (!apiToken) return;
    navigator.clipboard.writeText(apiToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  function handleCopyHeader() {
    if (!apiToken) return;
    navigator.clipboard.writeText(`Authorization: Bearer ${apiToken}`);
    setCopiedHeader(true);
    setTimeout(() => setCopiedHeader(false), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError(t("auth.fillAllFields"));
      return;
    }

    setLoading(true);
    setError("");
    setSuccessMsg("");

    const res = await updateUserProfile({
      name,
      email,
      currentPassword: currentPassword || undefined,
      newPassword: newPassword || undefined,
    });

    setLoading(false);

    if (res.success) {
      setSuccessMsg(t("profileModal.success"));
      setCurrentPassword("");
      setNewPassword("");
      router.refresh();
      setTimeout(() => {
        onClose();
      }, 1000);
    } else {
      setError(res.error || "Failed to update profile.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
              <User className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {t("profileModal.title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs font-semibold text-red-600 dark:text-red-400 text-center">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 text-center">
            <CheckCircle2 className="h-4 w-4" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("profileModal.nameLabel")}
            </label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {t("profileModal.emailLabel")}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t("profileModal.currentPasswordLabel")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t("profileModal.newPasswordLabel")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Developer API Token Section */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-indigo-500" />
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  {t("profileModal.apiTokensTitle")}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t("profileModal.apiTokensSub")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder={t("profileModal.tokenNamePlaceholder")}
                className="flex-1 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleGenerateToken}
                disabled={tokenLoading || !newTokenName.trim()}
                className="rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Key className="h-3.5 w-3.5" />
                <span>{tokenLoading ? t("profileModal.generating") : t("profileModal.generateToken")}</span>
              </button>
            </div>

            {apiToken && (
              <div className="space-y-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 border border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    readOnly
                    value={apiToken}
                    className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 pl-3 pr-10 py-1.5 text-[11px] font-mono text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    title={showToken ? "Hide Token" : "Reveal Token"}
                  >
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="flex-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    {copiedToken ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedToken ? t("profileModal.copied") : t("profileModal.copyToken")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyHeader}
                    className="flex-1 rounded-lg bg-slate-200 dark:bg-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {copiedHeader ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedHeader ? t("profileModal.copied") : t("profileModal.copyHeader")}</span>
                  </button>
                </div>

                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                  {t("profileModal.tokenSecurityNotice")}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <h5 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t("profileModal.activeTokens")}
              </h5>
              {tokens.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  {t("profileModal.noTokensYet")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {tokens.map((token) => (
                    <li
                      key={token.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {token.name}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {t("profileModal.createdLabel")} {new Date(token.createdAt).toLocaleDateString()}
                          {" · "}
                          {t("profileModal.lastUsedLabel")}{" "}
                          {token.lastUsedAt
                            ? new Date(token.lastUsedAt).toLocaleDateString()
                            : t("profileModal.neverUsed")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeToken(token)}
                        title={t("profileModal.revoke")}
                        className="shrink-0 rounded-lg p-1.5 text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {t("kanban.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all"
            >
              {loading ? t("profileModal.updating") : t("profileModal.updateProfile")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
