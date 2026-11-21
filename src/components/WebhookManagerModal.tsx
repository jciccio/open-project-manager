"use client";

import { useEffect, useState, useCallback } from "react";
import { Webhook, Plus, Trash2, Copy, Check, CheckCircle2 } from "lucide-react";
import { listWebhooks, createWebhook, updateWebhook, deleteWebhook } from "@/actions/webhooks";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhookEvents";
import ErrorBanner from "./ErrorBanner";
import { useTranslation } from "./LanguageProvider";
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, ModalDismissButton } from "./Modal";

interface Props {
  project: {
    id: string;
    name: string;
    userId: string;
    currentUserRole?: string | null;
  };
  onClose: () => void;
}

interface WebhookItem {
  id: string;
  projectId: string;
  url: string;
  eventsJson: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export default function WebhookManagerModal({ project, onClose }: Props) {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...WEBHOOK_EVENT_TYPES]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const refreshWebhooks = useCallback(async () => {
    try {
      const res = await listWebhooks(project.id);
      if (res.success && res.data) {
        setWebhooks(res.data as WebhookItem[]);
      }
    } catch {
      setError(t("webhookModal.failedToLoad"));
    }
  }, [project.id, t]);

  useEffect(() => {
    let ignore = false;
    listWebhooks(project.id)
      .then((res) => {
        if (ignore) return;
        if (res.success && res.data) {
          setWebhooks(res.data as WebhookItem[]);
        } else {
          setError(res.error || t("webhookModal.failedToLoad"));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!ignore) {
          setError(t("webhookModal.failedToLoad"));
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [project.id, t]);

  function toggleEvent(ev: string) {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  function handleSelectAll() {
    setSelectedEvents([...WEBHOOK_EVENT_TYPES]);
  }

  function handleDeselectAll() {
    setSelectedEvents([]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    if (selectedEvents.length === 0) {
      setError(t("webhookModal.selectEvent"));
      return;
    }

    setSubmitting(true);
    setError("");
    setNewSecret(null);
    setCopied(false);

    try {
      const res = await createWebhook(project.id, {
        url: url.trim(),
        events: selectedEvents,
      });

      if (res.success && res.data) {
        setUrl("");
        if (res.data.secret) {
          setNewSecret(res.data.secret);
        }
        await refreshWebhooks();
      } else {
        setError(res.error || t("webhookModal.failedToCreate"));
      }
    } catch {
      setError(t("webhookModal.failedToCreate"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(item: WebhookItem) {
    try {
      const res = await updateWebhook(item.id, { isActive: !item.isActive });
      if (res.success) {
        setWebhooks((prev) =>
          prev.map((w) => (w.id === item.id ? { ...w, isActive: !item.isActive } : w))
        );
      } else {
        setError(res.error || t("webhookModal.failedToUpdate"));
      }
    } catch {
      setError(t("webhookModal.failedToUpdate"));
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError("");
    try {
      const res = await deleteWebhook(id);
      if (res.success) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id));
      } else {
        setError(res.error || t("webhookModal.failedToDelete"));
      }
    } catch {
      setError(t("webhookModal.failedToDelete"));
    } finally {
      setDeletingId(null);
    }
  }

  function handleCopySecret() {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal labelledBy="webhook-modal-title" size="2xl" onEscape={onClose}>
        <ModalHeader>
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Webhook className="h-5 w-5 text-indigo-500" />
            <h2 id="webhook-modal-title" className="text-lg font-semibold">
              {t("webhookModal.title")}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
              ({project.name})
            </span>
          </div>
          <ModalCloseButton onClick={onClose} label={t("common.close")} />
        </ModalHeader>

        <ModalBody className="space-y-6">
          {error && <ErrorBanner message={error} />}

          {newSecret && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>{t("webhookModal.created")}</span>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("webhookModal.copySecretNotice")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-1.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 text-xs font-mono break-all select-all">
                  {newSecret}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? t("webhookModal.copied") : t("webhookModal.copy")}</span>
                </button>
              </div>
            </div>
          )}

          {/* Create Webhook Form */}
          <form onSubmit={handleCreate} className="space-y-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4 border border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-indigo-500" />
              {t("webhookModal.addHeading")}
            </h3>

            <div>
              <label htmlFor="webhook-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t("webhookModal.payloadUrl")}
              </label>
              <input
                id="webhook-url"
                type="url"
                required
                placeholder="https://example.com/api/webhook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {t("webhookModal.subscribedEvents", { selected: selectedEvents.length, total: WEBHOOK_EVENT_TYPES.length })}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {t("webhookModal.selectAll")}
                  </button>
                  <span className="text-xs text-slate-400">·</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {t("webhookModal.clear")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {WEBHOOK_EVENT_TYPES.map((ev) => {
                  const isChecked = selectedEvents.includes(ev);
                  return (
                    <label
                      key={ev}
                      className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer select-none transition-colors ${
                        isChecked
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleEvent(ev)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                      />
                      <span className="truncate">{ev}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>{submitting ? t("webhookModal.creating") : t("webhookModal.create")}</span>
              </button>
            </div>
          </form>

          {/* Configured Webhooks List */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("webhookModal.configuredHeading", { count: webhooks.length })}
            </h3>

            {loading ? (
              <div className="text-center py-6 text-sm text-slate-500">{t("webhookModal.loading")}</div>
            ) : webhooks.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                {t("webhookModal.empty")}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                {webhooks.map((hook) => {
                  let events: string[] = [];
                  try {
                    events = JSON.parse(hook.eventsJson);
                  } catch {
                    events = [];
                  }

                  return (
                    <div
                      key={hook.id}
                      className="p-4 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${
                              hook.isActive ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          <p className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {hook.url}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 items-center pt-1">
                          <span className="text-[10px] text-slate-500 font-medium">{t("webhookModal.events")}</span>
                          {events.slice(0, 5).map((ev) => (
                            <span
                              key={ev}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                            >
                              {ev}
                            </span>
                          ))}
                          {events.length > 5 && (
                            <span className="text-[10px] text-slate-500 font-medium">
                              {t("webhookModal.moreEvents", { count: events.length - 5 })}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(hook)}
                          className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                            hook.isActive
                              ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                              : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
                          }`}
                        >
                          {hook.isActive ? t("webhookModal.pause") : t("webhookModal.activate")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(hook.id)}
                          disabled={deletingId === hook.id}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
                          aria-label={t("webhookModal.deleteWebhook")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <ModalDismissButton onClick={onClose}>{t("common.close")}</ModalDismissButton>
        </ModalFooter>
    </Modal>
  );
}
