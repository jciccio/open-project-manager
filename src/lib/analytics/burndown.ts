import { AnalyticsCard, BurndownPoint, MetricMode } from "./types";
import { DateBucket, parseDate } from "./timeSeries";

export interface BurndownResult {
  points: BurndownPoint[];
  startRemaining: number;
  currentRemaining: number;
}

export function calculateBurndown(
  cards: AnalyticsCard[],
  buckets: DateBucket[],
  metricMode: MetricMode = "points",
  referenceDate: Date = new Date()
): BurndownResult {
  if (!buckets.length) {
    return {
      points: [],
      startRemaining: 0,
      currentRemaining: 0,
    };
  }

  const getItemValue = (c: AnalyticsCard): number => {
    return metricMode === "points" ? c.points || 0 : 1;
  };

  // Determine starting remaining points at the start of the first bucket
  const firstBucketStart = buckets[0].start;
  let startRemaining = 0;
  cards.forEach((card) => {
    const created = parseDate(card.createdAt);
    const completed = parseDate(card.completedAt);

    // If card was created before or around window start
    if (created && created <= firstBucketStart) {
      if (!completed || completed > firstBucketStart) {
        startRemaining += getItemValue(card);
      }
    } else if (created && created <= buckets[buckets.length - 1].end) {
      // If card was created during the window, count it towards baseline if starting total is low
      // but to preserve standard burndown, baseline represents active scope
    }
  });

  // If startRemaining calculated to 0 because cards were created recently,
  // use total uncompleted cards/points at start of window or total current scope
  if (startRemaining === 0) {
    cards.forEach((card) => {
      const created = parseDate(card.createdAt);
      if (!created || created <= referenceDate) {
        startRemaining += getItemValue(card);
      }
    });
  }

  const totalBuckets = buckets.length;
  let currentRemaining = 0;

  const points: BurndownPoint[] = buckets.map((bucket, index) => {
    const bucketEnd = bucket.end;
    const isFutureBucket = bucket.start > referenceDate;

    // Remaining points at bucketEnd
    let remaining = 0;
    if (!isFutureBucket) {
      cards.forEach((card) => {
        const created = parseDate(card.createdAt);
        const completed = parseDate(card.completedAt);

        const wasCreated = !created || created <= bucketEnd;
        const wasNotCompleted = !completed || completed > bucketEnd;

        if (wasCreated && wasNotCompleted) {
          remaining += getItemValue(card);
        }
      });
      currentRemaining = remaining;
    } else {
      remaining = currentRemaining;
    }

    // Ideal linear burndown from startRemaining at index 0 down to 0 at last bucket
    const idealRemaining =
      totalBuckets > 1
        ? Math.max(0, Math.round(startRemaining * (1 - index / (totalBuckets - 1))))
        : 0;

    return {
      date: bucket.key,
      label: bucket.label,
      idealRemaining,
      actualRemaining: remaining,
    };
  });

  return {
    points,
    startRemaining,
    currentRemaining,
  };
}
