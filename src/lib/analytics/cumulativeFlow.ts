import { AnalyticsCard, AnalyticsColumn, CumulativeFlowPoint, MetricMode } from "./types";
import { DateBucket, parseDate } from "./timeSeries";

export interface CumulativeFlowResult {
  points: CumulativeFlowPoint[];
  columns: Array<{ id: string; name: string; isDone: boolean }>;
}

export function calculateCumulativeFlow(
  columns: AnalyticsColumn[],
  cards: AnalyticsCard[],
  buckets: DateBucket[],
  metricMode: MetricMode = "cards"
): CumulativeFlowResult {
  if (!buckets.length || !columns.length) {
    return {
      points: [],
      columns: [],
    };
  }

  // Sort columns by order
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
  const doneColumn = sortedColumns.find((c) => c.isDone) || sortedColumns[sortedColumns.length - 1];
  const firstColumn = sortedColumns[0];

  const columnMeta = sortedColumns.map((c) => ({
    id: c.id,
    name: c.name,
    isDone: !!c.isDone,
  }));

  const getItemValue = (c: AnalyticsCard): number => {
    return metricMode === "points" ? c.points || 0 : 1;
  };

  const points: CumulativeFlowPoint[] = buckets.map((bucket) => {
    const bucketEnd = bucket.end;
    const colCounts: Record<string, number> = {};

    sortedColumns.forEach((c) => {
      colCounts[c.name] = 0;
    });

    cards.forEach((card) => {
      const createdAt = parseDate(card.createdAt);
      if (createdAt && createdAt > bucketEnd) {
        // Card was not created yet at this point in time
        return;
      }

      const completedAt = parseDate(card.completedAt);
      const isCompletedAtThisTime = completedAt && completedAt <= bucketEnd;

      if (isCompletedAtThisTime) {
        colCounts[doneColumn.name] = (colCounts[doneColumn.name] || 0) + getItemValue(card);
        return;
      }

      // Check card activities to find column at bucketEnd
      let assignedColName: string | null = null;

      if (card.activities && card.activities.length > 0) {
        const sortedMoves = card.activities
          .filter((a) => a.type === "moved")
          .sort((a, b) => {
            const da = parseDate(a.createdAt)?.getTime() || 0;
            const db = parseDate(b.createdAt)?.getTime() || 0;
            return da - db;
          });

        const movesBeforeBucket = sortedMoves.filter((m) => {
          const d = parseDate(m.createdAt);
          return d && d <= bucketEnd;
        });

        if (movesBeforeBucket.length > 0) {
          const latestMove = movesBeforeBucket[movesBeforeBucket.length - 1];
          // Try to match latestMove.toValue with a column name or ID
          const matched = sortedColumns.find(
            (c) =>
              c.id === latestMove.toValue ||
              c.name.toLowerCase() === (latestMove.toValue || "").toLowerCase()
          );
          if (matched) {
            assignedColName = matched.name;
          }
        } else if (sortedMoves.length > 0) {
          // No moves before bucketEnd, use fromValue of first move
          const firstMove = sortedMoves[0];
          const matched = sortedColumns.find(
            (c) =>
              c.id === firstMove.fromValue ||
              c.name.toLowerCase() === (firstMove.fromValue || "").toLowerCase()
          );
          if (matched) {
            assignedColName = matched.name;
          }
        }
      }

      if (!assignedColName) {
        // Fall back to current card column, or firstColumn if current column is Done but card wasn't done yet
        const currentCol = sortedColumns.find((c) => c.id === card.columnId);
        if (currentCol) {
          if (currentCol.isDone) {
            // Was not completed yet at bucketEnd, attribute to first or in-progress column
            const inProgressCol = sortedColumns.find((c) => !c.isDone && c.order > 0);
            assignedColName = (inProgressCol || firstColumn).name;
          } else {
            assignedColName = currentCol.name;
          }
        } else {
          assignedColName = firstColumn.name;
        }
      }

      if (colCounts[assignedColName] !== undefined) {
        colCounts[assignedColName] += getItemValue(card);
      } else {
        colCounts[firstColumn.name] = (colCounts[firstColumn.name] || 0) + getItemValue(card);
      }
    });

    const flowPoint: CumulativeFlowPoint = {
      date: bucket.key,
      label: bucket.label,
      ...colCounts,
    };

    return flowPoint;
  });

  return {
    points,
    columns: columnMeta,
  };
}
