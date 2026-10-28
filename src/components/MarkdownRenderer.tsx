"use client";

import ReactMarkdown from "react-markdown";
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
