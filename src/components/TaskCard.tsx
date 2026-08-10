"use client";

import { MessageSquare, Calendar, Zap, Link2, ShieldAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "./LanguageProvider";

interface Props {
  card: {
    id: string;
    title: string;
    description: string | null;
    number?: number;
    project?: { key: string };
    priority: string;
    points: number | null;
    owner: string | null;
    dueDate: Date | string | null;
    labels: Array<{
      label: {
        id: string;
        name: string;
        color: string;
      };
    }>;
    comments: Array<any>;
    incomingRelations?: Array<{
      type: string;
      sourceCard?: {
        number?: number;
        title?: string;
        project?: { key: string };
        column?: { isDone: boolean };
      };
    }>;
  };
  onClick: () => void;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  NONE: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500 dark:text-slate-400", border: "border-slate-300 dark:border-slate-700" },
  LOW: { bg: "bg-slate-100 dark:bg-slate-500/10", text: "text-slate-600 dark:text-slate-400", border: "border-slate-300 dark:border-slate-500/20" },
  MEDIUM: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-200 dark:border-blue-500/20" },
  HIGH: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-500/20" },
  URGENT: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-500/20" },
};

export default function TaskCard({ card, onClick }: Props) {
  const priorityStyle = PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.MEDIUM;
  const { t } = useTranslation();

  const activeBlockers = card.incomingRelations
    ? card.incomingRelations.filter(
        (r) => r.type === "BLOCKS" && (!r.sourceCard?.column || !r.sourceCard.column.isDone)
      )
    : [];

  const blockerLabel = activeBlockers
    .map((r) =>
      r.sourceCard?.project?.key && r.sourceCard?.number
        ? `${r.sourceCard.project.key}-${r.sourceCard.number}`
        : `#${r.sourceCard?.number || ""}`
    )
    .filter(Boolean)
    .join(", ");

  const blockerTooltip = activeBlockers
    .map((r) => `${r.sourceCard?.project?.key || ""}-${r.sourceCard?.number || ""}: ${r.sourceCard?.title || ""}`)
    .join("\n");

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-xs hover:border-indigo-500/50 dark:hover:border-indigo-500/40 hover:shadow-md hover:shadow-indigo-500/10 transition-all select-none"
    >
      {/* Identifier & Label Chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
        {card.number && (
          <span className="inline-block rounded-md bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
            {card.project?.key ? `${card.project.key}-${card.number}` : `#${card.number}`}
          </span>
        )}
        {card.labels &&
          card.labels.length > 0 &&
          card.labels.map(({ label }) => (
            <span
              key={label.id}
              className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide text-white shadow-2xs"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
      </div>

      {/* Card Title */}
      <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors leading-snug">
        {card.title}
      </h4>

      {/* Description Snippet */}
      {card.description && (
        <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed prose dark:prose-invert max-w-none">
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
            {card.description}
          </ReactMarkdown>
        </div>
      )}

      {/* Badges Footer */}
      <div className="mt-3.5 pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Priority Badge */}
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}
          >
            {card.priority}
          </span>

          {/* Blocked Indicator Badge */}
          {activeBlockers.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20"
              title={`Blocked by:\n${blockerTooltip}`}
            >
              <ShieldAlert className="h-2.5 w-2.5 text-rose-500 animate-pulse" />
              <span>Blocked {blockerLabel ? `(${blockerLabel})` : ""}</span>
            </span>
          )}

          {/* Points Badge */}
          {card.points !== null && card.points !== undefined && (
            <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20">
              <Zap className="h-2.5 w-2.5" />
              <span>{card.points} {t("kanban.pts")}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-[11px]">
          {/* Comments Count */}
          {card.comments && card.comments.length > 0 && (
            <div className="flex items-center gap-1" title={`${card.comments.length} comments`}>
              <MessageSquare className="h-3 w-3 text-slate-400" />
              <span>{card.comments.length}</span>
            </div>
          )}

          {/* Due Date */}
          {card.dueDate && (
            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-400" title="Due Date">
              <Calendar className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
              <span>{new Date(card.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
          )}

          {/* Owner Avatar/Name */}
          {card.owner && (
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-600/30 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/30 font-bold text-[10px]"
              title={`Assigned to ${card.owner}`}
            >
              {card.owner.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
