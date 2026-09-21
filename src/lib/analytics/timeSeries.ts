import { TimeRangeOption, AnalyticsCard } from "./types";

export interface DateBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

export function parseDate(d: Date | string | undefined | null): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return isNaN(date.getTime()) ? null : date;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function getDateWindow(
  timeRange: TimeRangeOption,
  referenceDate: Date = new Date(),
  cards: AnalyticsCard[] = []
): { startDate: Date; endDate: Date; bucketInterval: "day" | "week" | "month" } {
  const endDate = new Date(referenceDate);
  endDate.setHours(23, 59, 59, 999);

  let daysBack = 14;
  let bucketInterval: "day" | "week" | "month" = "day";

  if (timeRange === "7d") {
    daysBack = 7;
    bucketInterval = "day";
  } else if (timeRange === "14d") {
    daysBack = 14;
    bucketInterval = "day";
  } else if (timeRange === "30d") {
    daysBack = 30;
    bucketInterval = "day";
  } else if (timeRange === "90d") {
    daysBack = 90;
    bucketInterval = "week";
  } else if (timeRange === "all") {
    // Determine earliest card creation date or fallback to 30 days
    let earliest = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    cards.forEach((c) => {
      const created = parseDate(c.createdAt);
      if (created && created < earliest) {
        earliest = created;
      }
    });

    const diffDays = Math.ceil((endDate.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 31) {
      bucketInterval = "day";
    } else if (diffDays <= 180) {
      bucketInterval = "week";
    } else {
      bucketInterval = "month";
    }

    const startDate = new Date(earliest);
    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate, bucketInterval };
  }

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (daysBack - 1));
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate, bucketInterval };
}

export function generateDateBuckets(
  startDate: Date,
  endDate: Date,
  interval: "day" | "week" | "month"
): DateBucket[] {
  const buckets: DateBucket[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  if (interval === "day") {
    while (current <= endDate) {
      const bucketStart = new Date(current);
      const bucketEnd = new Date(current);
      bucketEnd.setHours(23, 59, 59, 999);

      buckets.push({
        key: formatDateKey(bucketStart),
        label: formatShortDate(bucketStart),
        start: bucketStart,
        end: bucketEnd,
      });

      current.setDate(current.getDate() + 1);
    }
  } else if (interval === "week") {
    while (current <= endDate) {
      const bucketStart = new Date(current);
      const bucketEnd = new Date(current);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
      bucketEnd.setHours(23, 59, 59, 999);

      const effectiveEnd = bucketEnd > endDate ? new Date(endDate) : bucketEnd;

      buckets.push({
        key: formatDateKey(bucketStart),
        label: `${formatShortDate(bucketStart)} - ${formatShortDate(effectiveEnd)}`,
        start: bucketStart,
        end: effectiveEnd,
      });

      current.setDate(current.getDate() + 7);
    }
  } else {
    // monthly
    while (current <= endDate) {
      const bucketStart = new Date(current.getFullYear(), current.getMonth(), 1, 0, 0, 0, 0);
      const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1, 0, 0, 0, 0);
      const bucketEnd = new Date(nextMonth.getTime() - 1);
      const effectiveEnd = bucketEnd > endDate ? new Date(endDate) : bucketEnd;

      const label = bucketStart.toLocaleDateString(undefined, { month: "short", year: "numeric" });

      buckets.push({
        key: `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}`,
        label,
        start: bucketStart,
        end: effectiveEnd,
      });

      current.setMonth(current.getMonth() + 1);
      current.setDate(1);
    }
  }

  return buckets;
}
