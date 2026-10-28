"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeHref } from "@/lib/validation/safeUrl";

interface Props {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: Props) {
  if (!content) return null;

  return (
    <div className={`prose dark:prose-invert max-w-none text-xs leading-relaxed space-y-1.5 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          a({ href, children, ...props }) {
            const safe = safeHref(href);
            return (
              <a
                href={safe}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-500"
                {...props}
              >
                {children}
              </a>
            );
          },
          p({ children, ...props }) {
            return (
              <p className="my-1 break-words" {...props}>
                {children}
              </p>
            );
          },
          table({ children, ...props }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 text-left text-xs" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800/60 font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="px-3 py-1.5 border-t border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300" {...props}>
                {children}
              </td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
