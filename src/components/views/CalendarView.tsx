"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Zap } from "lucide-react";
import { useTranslation } from "../LanguageProvider";

interface Props {
  project: any;
  onCardClick: (card: any) => void;
  searchQuery: string;
  priorityFilter: string;
}

export default function CalendarView({
  project,
  onCardClick,
  searchQuery,
  priorityFilter,
}: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const { t, locale } = useTranslation();

  // Collect all cards across all columns
  const allCards = useMemo(() => {
    const list: any[] = [];
    project.columns.forEach((col: any) => {
      (col.cards || []).forEach((card: any) => {
        list.push({ ...card, columnStatus: col.name });
      });
    });
    return list.filter((card) => {
      const matchesSearch =
        searchQuery === "" ||
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (card.description && card.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (card.owner && card.owner.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesPriority =
        priorityFilter === "ALL" || card.priority === priorityFilter;

      return matchesSearch && matchesPriority;
    });
  }, [project, searchQuery, priorityFilter]);

  // Separate scheduled vs unscheduled
  const { scheduledMap, unscheduledCards } = useMemo(() => {
    const map: Record<string, any[]> = {};
    const unscheduled: any[] = [];

    allCards.forEach((card) => {
      if (card.dueDate) {
        const key = new Date(card.dueDate).toISOString().substring(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(card);
      } else {
        unscheduled.push(card);
      }
    });

    return { scheduledMap: map, unscheduledCards: unscheduled };
  }, [allCards]);

  // Calendar Days calculation. Due dates are stored and bucketed as UTC
  // calendar dates (see scheduledMap above), so the grid itself must also
  // be computed in UTC - mixing local-timezone grid math with UTC-bucketed
  // due dates puts "today" and due-date cells in two different calendars.
  const year = currentDate.getUTCFullYear();
  const month = currentDate.getUTCMonth();

  const firstDayOfMonth = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const monthName = currentDate.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    month: "long",
    timeZone: "UTC",
  });

  function prevMonth() {
    setCurrentDate(new Date(Date.UTC(year, month - 1, 1)));
  }

  function nextMonth() {
    setCurrentDate(new Date(Date.UTC(year, month + 1, 1)));
  }

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col lg:flex-row gap-6">
      {/* Calendar Grid Container */}
      <div className="flex-1 glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
        {/* Navigation Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <CalendarIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-lg text-slate-900 dark:text-white capitalize">
              {monthName} {year}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="rounded-lg p-2 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="rounded-lg px-3 py-1.5 bg-slate-100 dark:bg-slate-800/80 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {t("calendar.today")}
            </button>
            <button
              onClick={nextMonth}
              className="rounded-lg p-2 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 text-center font-bold text-xs text-slate-500 dark:text-slate-400 py-2 border-b border-slate-200 dark:border-slate-800">
          <div>{locale === "es" ? "Dom" : "Sun"}</div>
          <div>{locale === "es" ? "Lun" : "Mon"}</div>
          <div>{locale === "es" ? "Mar" : "Tue"}</div>
          <div>{locale === "es" ? "Mié" : "Wed"}</div>
          <div>{locale === "es" ? "Jue" : "Thu"}</div>
          <div>{locale === "es" ? "Vie" : "Fri"}</div>
          <div>{locale === "es" ? "Sáb" : "Sat"}</div>
        </div>

        {/* Grid Cells */}
        <div className="grid grid-cols-7 gap-1.5">
          {/* Leading empty cells */}
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="h-28 rounded-xl bg-slate-100/50 dark:bg-slate-900/20 border border-slate-200/60 dark:border-slate-800/40" />
          ))}

          {/* Month Days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const dayCards = scheduledMap[dateStr] || [];
            const isToday =
              new Date().toISOString().substring(0, 10) === dateStr;

            return (
              <div
                key={`day-${dayNum}`}
                className={`h-28 rounded-xl p-2 border overflow-y-auto flex flex-col justify-between transition-colors ${
                  isToday
                    ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-500/50"
                    : "bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`font-bold text-xs rounded-full h-5 w-5 flex items-center justify-center ${
                      isToday ? "bg-indigo-600 text-white" : "text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {dayNum}
                  </span>
                  {dayCards.length > 0 && (
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                      {dayCards.length}
                    </span>
                  )}
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto pr-0.5">
                  {dayCards.map((card) => (
                    <div
                      key={card.id}
                      onClick={() => onCardClick(card)}
                      className="rounded-md bg-indigo-100 dark:bg-indigo-600/30 border border-indigo-200 dark:border-indigo-500/40 px-1.5 py-1 text-[10px] font-bold text-indigo-900 dark:text-slate-100 truncate hover:bg-indigo-200 dark:hover:bg-indigo-600/50 cursor-pointer"
                      title={card.title}
                    >
                      {card.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled Sidebar */}
      <div className="w-full lg:w-80 glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4 shrink-0">
        <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <span>{t("calendar.unscheduledTasks")}</span>
          <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-400">
            {unscheduledCards.length}
          </span>
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("calendar.unscheduledSub")}
        </p>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {unscheduledCards.length > 0 ? (
            unscheduledCards.map((card) => (
              <div
                key={card.id}
                onClick={() => onCardClick(card)}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 hover:border-indigo-500/40 cursor-pointer transition-all space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-slate-900 dark:text-slate-200 line-clamp-1">
                    {card.title}
                  </span>
                  {card.points !== null && (
                    <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-0.5">
                      <Zap className="h-2.5 w-2.5" />
                      {card.points}
                    </span>
                  )}
                </div>
                <span className="inline-block text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                  {card.columnStatus}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">{t("calendar.allHasDueDate")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
