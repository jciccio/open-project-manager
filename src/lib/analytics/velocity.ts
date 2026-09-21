import { AnalyticsCard, VelocityInterval } from "./types";
import { DateBucket, parseDate } from "./timeSeries";

export interface VelocityResult {
  intervals: VelocityInterval[];
  totalCompletedPoints: number;
  totalCompletedCards: number;
  averageWeeklyVelocity: number;
}

export function calculateVelocity(
  cards: AnalyticsCard[],
  buckets: DateBucket[]
): VelocityResult {
  if (!buckets.length) {
    return {
      intervals: [],
      totalCompletedPoints: 0,
      totalCompletedCards: 0,
      averageWeeklyVelocity: 0,
    };
  }

  let totalCompletedPoints = 0;
  let totalCompletedCards = 0;

  const intervals: VelocityInterval[] = buckets.map((bucket) => {
    let completedPoints = 0;
    let completedCards = 0;

    cards.forEach((card) => {
      const completed = parseDate(card.completedAt);
      if (completed && completed >= bucket.start && completed <= bucket.end) {
        completedPoints += card.points || 0;
        completedCards += 1;
      }
    });

    totalCompletedPoints += completedPoints;
    totalCompletedCards += completedCards;

    return {
      date: bucket.key,
      label: bucket.label,
      completedPoints,
      completedCards,
    };
  });

  // Calculate average weekly velocity over the time span of all buckets
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  const totalDays = Math.max(
    1,
    Math.round((lastBucket.end.getTime() - firstBucket.start.getTime()) / (1000 * 60 * 60 * 24))
  );
  const totalWeeks = Math.max(1, totalDays / 7);
  const averageWeeklyVelocity = Math.round((totalCompletedPoints / totalWeeks) * 10) / 10;

  return {
    intervals,
    totalCompletedPoints,
    totalCompletedCards,
    averageWeeklyVelocity,
  };
}
