import { describe, it, expect } from "vitest";
import {
  getDateWindow,
  generateDateBuckets,
  formatDateKey,
  parseDate,
} from "../timeSeries";
import { calculateVelocity } from "../velocity";
import { calculateBurndown } from "../burndown";
import { calculateCycleTime } from "../cycleTime";
import { calculateCumulativeFlow } from "../cumulativeFlow";
import { AnalyticsCard, AnalyticsColumn } from "../types";

describe("Analytics Utilities", () => {
  describe("timeSeries", () => {
    it("parses valid dates and returns null for invalid/empty", () => {
      expect(parseDate("2026-09-15T12:00:00Z")).toBeInstanceOf(Date);
      expect(parseDate(new Date())).toBeInstanceOf(Date);
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate("invalid-date")).toBeNull();
    });

    it("formats date keys consistently as YYYY-MM-DD", () => {
      const date = new Date(2026, 8, 20); // Sept 20, 2026
      expect(formatDateKey(date)).toBe("2026-09-20");
    });

    it("creates 7-day date window correctly", () => {
      const ref = new Date(2026, 8, 20);
      const { startDate, endDate, bucketInterval } = getDateWindow("7d", ref);
      expect(bucketInterval).toBe("day");
      expect(formatDateKey(endDate)).toBe("2026-09-20");
      expect(formatDateKey(startDate)).toBe("2026-09-14");
    });

    it("generates daily buckets spanning start to end", () => {
      const start = new Date(2026, 8, 14);
      const end = new Date(2026, 8, 20);
      const buckets = generateDateBuckets(start, end, "day");
      expect(buckets).toHaveLength(7);
      expect(buckets[0].key).toBe("2026-09-14");
      expect(buckets[6].key).toBe("2026-09-20");
    });
  });

  describe("velocity", () => {
    const buckets = generateDateBuckets(new Date(2026, 8, 1), new Date(2026, 8, 5), "day");

    const sampleCards: AnalyticsCard[] = [
      {
        id: "c1",
        number: 1,
        title: "Task 1",
        points: 5,
        columnId: "col-done",
        createdAt: "2026-09-01T08:00:00Z",
        completedAt: "2026-09-02T10:00:00Z",
      },
      {
        id: "c2",
        number: 2,
        title: "Task 2",
        points: 3,
        columnId: "col-done",
        createdAt: "2026-09-01T08:00:00Z",
        completedAt: "2026-09-02T15:00:00Z",
      },
      {
        id: "c3",
        number: 3,
        title: "Task 3",
        points: 8,
        columnId: "col-done",
        createdAt: "2026-09-01T08:00:00Z",
        completedAt: "2026-09-04T12:00:00Z",
      },
      {
        id: "c4",
        number: 4,
        title: "Task 4 (uncompleted)",
        points: 2,
        columnId: "col-todo",
        createdAt: "2026-09-01T08:00:00Z",
        completedAt: null,
      },
    ];

    it("aggregates completed points and cards per bucket", () => {
      const result = calculateVelocity(sampleCards, buckets);
      expect(result.totalCompletedPoints).toBe(16);
      expect(result.totalCompletedCards).toBe(3);

      const sep2Bucket = result.intervals.find((i) => i.date === "2026-09-02");
      expect(sep2Bucket).toBeDefined();
      expect(sep2Bucket?.completedPoints).toBe(8);
      expect(sep2Bucket?.completedCards).toBe(2);

      const sep3Bucket = result.intervals.find((i) => i.date === "2026-09-03");
      expect(sep3Bucket?.completedPoints).toBe(0);
      expect(sep3Bucket?.completedCards).toBe(0);

      const sep4Bucket = result.intervals.find((i) => i.date === "2026-09-04");
      expect(sep4Bucket?.completedPoints).toBe(8);
      expect(sep4Bucket?.completedCards).toBe(1);
    });

    it("returns zero metrics for empty buckets or empty cards", () => {
      const result = calculateVelocity([], buckets);
      expect(result.totalCompletedPoints).toBe(0);
      expect(result.totalCompletedCards).toBe(0);
      expect(result.averageWeeklyVelocity).toBe(0);
    });
  });

  describe("burndown", () => {
    const buckets = generateDateBuckets(new Date(2026, 8, 1), new Date(2026, 8, 4), "day");

    const sampleCards: AnalyticsCard[] = [
      {
        id: "c1",
        number: 1,
        title: "Task 1",
        points: 5,
        columnId: "col-done",
        createdAt: "2026-08-31T00:00:00Z",
        completedAt: "2026-09-02T12:00:00Z",
      },
      {
        id: "c2",
        number: 2,
        title: "Task 2",
        points: 5,
        columnId: "col-done",
        createdAt: "2026-08-31T00:00:00Z",
        completedAt: "2026-09-03T12:00:00Z",
      },
      {
        id: "c3",
        number: 3,
        title: "Task 3",
        points: 10,
        columnId: "col-todo",
        createdAt: "2026-08-31T00:00:00Z",
        completedAt: null,
      },
    ];

    it("calculates remaining points and ideal trajectory", () => {
      const ref = new Date(2026, 8, 5);
      const result = calculateBurndown(sampleCards, buckets, "points", ref);

      expect(result.startRemaining).toBe(20);
      expect(result.points).toHaveLength(4);

      // On Sep 1: no cards completed yet -> remaining 20
      expect(result.points[0].actualRemaining).toBe(20);
      expect(result.points[0].idealRemaining).toBe(20);

      // On Sep 2: Task 1 completed (5 pts) -> remaining 15
      expect(result.points[1].actualRemaining).toBe(15);

      // On Sep 3: Task 2 completed (5 pts) -> remaining 10
      expect(result.points[2].actualRemaining).toBe(10);

      // Ideal line reaches 0 at end
      expect(result.points[3].idealRemaining).toBe(0);
    });

    it("supports card count mode for burndown", () => {
      const ref = new Date(2026, 8, 5);
      const result = calculateBurndown(sampleCards, buckets, "cards", ref);
      expect(result.startRemaining).toBe(3);
      // Sep 1: 3, Sep 2: 2, Sep 3: 1, Sep 4: 1
      expect(result.points[0].actualRemaining).toBe(3);
      expect(result.points[1].actualRemaining).toBe(2);
      expect(result.points[2].actualRemaining).toBe(1);
    });
  });

  describe("cycleTime", () => {
    it("calculates lead and cycle times accurately with activity events", () => {
      const cards: AnalyticsCard[] = [
        {
          id: "c1",
          number: 1,
          title: "Feature A",
          columnId: "done",
          createdAt: "2026-09-01T00:00:00Z",
          completedAt: "2026-09-06T00:00:00Z", // 5 days lead time
          activities: [
            {
              type: "moved",
              fromValue: "Backlog",
              toValue: "In Progress",
              createdAt: "2026-09-04T00:00:00Z", // 2 days cycle time
            },
          ],
        },
        {
          id: "c2",
          number: 2,
          title: "Bug B",
          columnId: "done",
          createdAt: "2026-09-02T00:00:00Z",
          completedAt: "2026-09-04T00:00:00Z", // 2 days lead time, no moves -> 2 days cycle
        },
      ];

      const summary = calculateCycleTime(cards);
      expect(summary.completedCount).toBe(2);
      expect(summary.records[0].leadTimeDays).toBe(5);
      expect(summary.records[0].cycleTimeDays).toBe(2);
      expect(summary.records[1].leadTimeDays).toBe(2);
      expect(summary.records[1].cycleTimeDays).toBe(2);

      expect(summary.avgLeadTimeDays).toBe(3.5);
      expect(summary.avgCycleTimeDays).toBe(2);
      expect(summary.medianCycleTimeDays).toBe(2);
    });

    it("handles zero completed cards gracefully", () => {
      const summary = calculateCycleTime([]);
      expect(summary.avgCycleTimeDays).toBe(0);
      expect(summary.avgLeadTimeDays).toBe(0);
      expect(summary.records).toHaveLength(0);
    });
  });

  describe("cumulativeFlow", () => {
    const columns: AnalyticsColumn[] = [
      { id: "col-1", name: "Backlog", order: 0 },
      { id: "col-2", name: "In Progress", order: 1 },
      { id: "col-3", name: "Done", order: 2, isDone: true },
    ];

    const buckets = generateDateBuckets(new Date(2026, 8, 1), new Date(2026, 8, 3), "day");

    const d1 = new Date(2026, 8, 1, 10, 0, 0);
    const d2 = new Date(2026, 8, 2, 10, 0, 0);
    const d3 = new Date(2026, 8, 3, 10, 0, 0);

    const cards: AnalyticsCard[] = [
      {
        id: "c1",
        number: 1,
        title: "Card 1",
        columnId: "col-3",
        createdAt: d1,
        completedAt: d3,
        activities: [
          {
            type: "moved",
            fromValue: "col-1",
            toValue: "col-2",
            createdAt: d2,
          },
        ],
      },
    ];

    it("tracks card movement across columns over time", () => {
      const cfd = calculateCumulativeFlow(columns, cards, buckets, "cards");
      expect(cfd.points).toHaveLength(3);

      // On Sep 1: Card 1 created, before move -> Backlog: 1, In Progress: 0, Done: 0
      expect(cfd.points[0]["Backlog"]).toBe(1);
      expect(cfd.points[0]["In Progress"]).toBe(0);
      expect(cfd.points[0]["Done"]).toBe(0);

      // On Sep 2: Card 1 moved to In Progress -> Backlog: 0, In Progress: 1, Done: 0
      expect(cfd.points[1]["Backlog"]).toBe(0);
      expect(cfd.points[1]["In Progress"]).toBe(1);
      expect(cfd.points[1]["Done"]).toBe(0);

      // On Sep 3: Card 1 completed -> Done: 1
      expect(cfd.points[2]["Done"]).toBe(1);
      expect(cfd.points[2]["In Progress"]).toBe(0);
    });
  });
});
