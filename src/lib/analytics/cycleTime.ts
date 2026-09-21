import { AnalyticsCard, CycleTimeRecord, CycleTimeSummary } from "./types";
import { parseDate } from "./timeSeries";

export function calculateCycleTime(
  cards: AnalyticsCard[],
  filterStart?: Date,
  filterEnd?: Date
): CycleTimeSummary {
  const records: CycleTimeRecord[] = [];

  cards.forEach((card) => {
    const completedAt = parseDate(card.completedAt);
    if (!completedAt) return;

    // Filter by completion date window if provided
    if (filterStart && completedAt < filterStart) return;
    if (filterEnd && completedAt > filterEnd) return;

    const createdAt = parseDate(card.createdAt) || completedAt;

    // Calculate Lead Time (creation -> completion) in days
    const leadTimeMs = Math.max(0, completedAt.getTime() - createdAt.getTime());
    const leadTimeDays = Math.max(0.1, Math.round((leadTimeMs / (1000 * 60 * 60 * 24)) * 10) / 10);

    // Calculate Cycle Time (started work -> completion)
    let inProgressDate: Date | null = null;

    if (card.activities && card.activities.length > 0) {
      // Sort activities chronological
      const sortedActivities = [...card.activities].sort((a, b) => {
        const da = parseDate(a.createdAt)?.getTime() || 0;
        const db = parseDate(b.createdAt)?.getTime() || 0;
        return da - db;
      });

      // Find first move into in-progress column or out of backlog
      const moveActivity = sortedActivities.find((act) => {
        if (act.type === "moved") {
          const target = (act.toValue || "").toLowerCase();
          return (
            target.includes("progress") ||
            target.includes("doing") ||
            target.includes("active") ||
            target.includes("dev")
          );
        }
        return false;
      });

      if (moveActivity) {
        inProgressDate = parseDate(moveActivity.createdAt);
      } else {
        // Find earliest moved activity of any kind
        const anyMove = sortedActivities.find((act) => act.type === "moved");
        if (anyMove) {
          inProgressDate = parseDate(anyMove.createdAt);
        }
      }
    }

    let cycleTimeDays = leadTimeDays;
    if (inProgressDate && inProgressDate <= completedAt && inProgressDate >= createdAt) {
      const cycleMs = completedAt.getTime() - inProgressDate.getTime();
      cycleTimeDays = Math.max(0.1, Math.round((cycleMs / (1000 * 60 * 60 * 24)) * 10) / 10);
    }

    records.push({
      cardId: card.id,
      cardNumber: card.number,
      title: card.title,
      leadTimeDays,
      cycleTimeDays: Math.min(leadTimeDays, cycleTimeDays),
      completedAt: completedAt.toISOString(),
    });
  });

  if (records.length === 0) {
    return {
      avgLeadTimeDays: 0,
      avgCycleTimeDays: 0,
      medianCycleTimeDays: 0,
      completedCount: 0,
      records: [],
    };
  }

  const totalLead = records.reduce((acc, r) => acc + r.leadTimeDays, 0);
  const totalCycle = records.reduce((acc, r) => acc + r.cycleTimeDays, 0);

  const avgLeadTimeDays = Math.round((totalLead / records.length) * 10) / 10;
  const avgCycleTimeDays = Math.round((totalCycle / records.length) * 10) / 10;

  // Calculate median cycle time
  const sortedCycleTimes = [...records.map((r) => r.cycleTimeDays)].sort((a, b) => a - b);
  const mid = Math.floor(sortedCycleTimes.length / 2);
  const medianCycleTimeDays =
    sortedCycleTimes.length % 2 !== 0
      ? sortedCycleTimes[mid]
      : Math.round(((sortedCycleTimes[mid - 1] + sortedCycleTimes[mid]) / 2) * 10) / 10;

  return {
    avgLeadTimeDays,
    avgCycleTimeDays,
    medianCycleTimeDays,
    completedCount: records.length,
    records,
  };
}
