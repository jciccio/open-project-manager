"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bold,
  Italic,
  Code,
  Heading,
  List,
  Link,
  Eye,
  Edit3,
} from "lucide-react";
import { useTranslation } from "./LanguageProvider";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write description in Markdown...",
  rows = 5,
}: Props) {
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const { t } = useTranslation();

  function insertFormatting(prefix: string, suffix: string = "") {
    const textarea = document.getElementById(
      "markdown-editor-textarea"
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const replacement = `${prefix}${selected || "text"}${suffix}`;

    const newValue =
      value.substring(0, start) + replacement + value.substring(end);
    onChange(newValue);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selected ? selected.length : 4)
      );
    }, 0);
  }

  return (
    <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 overflow-hidden shadow-2xs">
      {/* Header Toolbar & Tab Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("write")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${
              activeTab === "write"
                ? "bg-indigo-600 text-white shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>{t("markdownEditor.write")}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${
              activeTab === "preview"
                ? "bg-indigo-600 text-white shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{t("markdownEditor.preview")}</span>
          </button>
        </div>

        {activeTab === "write" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => insertFormatting("**", "**")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.bold")}
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("*", "*")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.italic")}
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("### ")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.heading")}
            >
              <Heading className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("`", "`")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.code")}
            >
              <Code className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("- ")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.list")}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("[", "](url)")}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
              title={t("markdownEditor.link")}
            >
              <Link className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Editor / Preview Container */}
      <div className="p-3">
        {activeTab === "write" ? (
          <textarea
            id="markdown-editor-textarea"
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none resize-y leading-relaxed font-mono"
          />
        ) : (
          <div className="min-h-[100px] text-xs text-slate-900 dark:text-slate-100 prose dark:prose-invert max-w-none space-y-2 leading-relaxed">
            {value.trim() ? (
              <ReactMarkdown
                components={{
                  code({ className, children, ...props }) {
                    return (
                      <code
                        className={`rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-300 ${
                          className || ""
                        }`}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {value}
              </ReactMarkdown>
            ) : (
              <p className="text-slate-400 italic">
                {t("markdownEditor.nothingToPreview")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
