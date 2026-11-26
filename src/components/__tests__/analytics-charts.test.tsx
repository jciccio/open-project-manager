import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LanguageProvider } from "../LanguageProvider";
import AnalyticsKpiCards from "../views/analytics/AnalyticsKpiCards";
import AnalyticsTimeFilter from "../views/analytics/AnalyticsTimeFilter";
import VelocityChart from "../views/analytics/VelocityChart";
import BurndownChart from "../views/analytics/BurndownChart";
import CycleTimeChart from "../views/analytics/CycleTimeChart";
import CumulativeFlowChart from "../views/analytics/CumulativeFlowChart";
import type {
  BurndownPoint,
  CumulativeFlowPoint,
  CycleTimeRecord,
  CycleTimeSummary,
  VelocityInterval,
} from "@/lib/analytics/types";

// jsdom has no layout, so a real ResponsiveContainer measures 0x0 and Recharts draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 2000, height: 300 })
        : null,
  };
});

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const NO_DATA = "No historical data recorded for this time range";

function renderEn(ui: ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

function legend(container: HTMLElement): Record<string, string | null> {
  const items = container.querySelectorAll(".recharts-legend-wrapper .recharts-legend-item");
  return Object.fromEntries(
    Array.from(items, (item) => {
      const icon = item.querySelector(".recharts-legend-icon");
      const fill = icon?.getAttribute("fill");
      return [item.textContent, fill && fill !== "none" ? fill : icon?.getAttribute("stroke") ?? null];
    })
  );
}

function xTicks(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value"),
    (tick) => tick.textContent ?? ""
  );
}

describe("AnalyticsKpiCards", () => {
  const base = {
    totalPoints: 40,
    completedPoints: 10,
    inProgressPoints: 7,
    totalCards: 8,
    completedCards: 6,
    weeklyVelocity: 13,
    avgCycleTimeDays: 2.5,
  };

  it("shows velocity, cycle time, completed points with their share of the scope, and the scope", () => {
    renderEn(<AnalyticsKpiCards {...base} />);

    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("2.5")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("(25%)")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("(8 total cards)")).toBeInTheDocument();
  });

  it("falls back to the card completion rate when no card has points", () => {
    renderEn(<AnalyticsKpiCards {...base} totalPoints={0} completedPoints={0} />);

    expect(screen.getByText("(75%)")).toBeInTheDocument();
  });

  it("shows 0% with no points and no cards, and -- for a zero cycle time", () => {
    renderEn(
      <AnalyticsKpiCards {...base} totalPoints={0} completedPoints={0} totalCards={0} completedCards={0} avgCycleTimeDays={0} />
    );

    expect(screen.getByText("(0%)")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
  });
});

describe("AnalyticsTimeFilter", () => {
  function renderFilter(timeRange: "7d" | "14d" | "30d" | "90d" | "all" = "30d", metricMode: "points" | "cards" = "points") {
    const setTimeRange = vi.fn();
    const setMetricMode = vi.fn();
    renderEn(
      <AnalyticsTimeFilter timeRange={timeRange} setTimeRange={setTimeRange} metricMode={metricMode} setMetricMode={setMetricMode} />
    );
    return { setTimeRange, setMetricMode };
  }

  it("calls setTimeRange with the id of each range button", () => {
    const { setTimeRange } = renderFilter();

    for (const [label, id] of [
      ["7 Days", "7d"],
      ["14 Days", "14d"],
      ["30 Days", "30d"],
      ["90 Days", "90d"],
      ["All Time", "all"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(setTimeRange).toHaveBeenLastCalledWith(id);
    }
    expect(setTimeRange).toHaveBeenCalledTimes(5);
  });

  it("highlights only the active range", () => {
    renderFilter("90d");

    expect(screen.getByRole("button", { name: "90 Days" })).toHaveClass("bg-indigo-600");
    expect(screen.getByRole("button", { name: "7 Days" })).not.toHaveClass("bg-indigo-600");
  });

  it("switches between points and cards", () => {
    const { setMetricMode } = renderFilter("30d", "points");

    fireEvent.click(screen.getByRole("button", { name: "Card Count" }));
    expect(setMetricMode).toHaveBeenLastCalledWith("cards");
    fireEvent.click(screen.getByRole("button", { name: "Story Points" }));
    expect(setMetricMode).toHaveBeenLastCalledWith("points");
  });
});

describe("VelocityChart", () => {
  const intervals: VelocityInterval[] = [
    { date: "2026-11-02", label: "Nov 2", completedPoints: 5, completedCards: 2 },
    { date: "2026-11-09", label: "Nov 9", completedPoints: 0, completedCards: 0 },
  ];

  it("shows the empty state when nothing was completed in the range", () => {
    const { container } = renderEn(
      <VelocityChart intervals={intervals.map((i) => ({ ...i, completedPoints: 0, completedCards: 0 }))} metricMode="points" isDark={false} />
    );

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("plots points and cards per interval in points mode", () => {
    const { container } = renderEn(<VelocityChart intervals={intervals} metricMode="points" isDark={false} />);

    expect(screen.queryByText(NO_DATA)).toBeNull();
    expect(legend(container)).toEqual({ "Story Points": "#6366f1", "Card Count": "#a855f7" });
    expect(xTicks(container)).toEqual(["Nov 2", "Nov 9"]);
  });

  it("plots only cards in cards mode", () => {
    const { container } = renderEn(<VelocityChart intervals={intervals} metricMode="cards" isDark={false} />);

    expect(legend(container)).toEqual({ "Card Count": "#6366f1" });
  });
});

describe("BurndownChart", () => {
  const points: BurndownPoint[] = [
    { date: "2026-11-01", label: "Nov 1", idealRemaining: 10, actualRemaining: 10 },
    { date: "2026-11-02", label: "Nov 2", idealRemaining: 5, actualRemaining: 7 },
  ];

  it("shows the empty state with no points", () => {
    renderEn(<BurndownChart points={[]} startRemaining={10} currentRemaining={7} metricMode="points" isDark={false} />);

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(screen.queryByText("Remaining / Scope")).toBeNull();
  });

  it("shows the empty state when the range started with nothing left to do", () => {
    renderEn(<BurndownChart points={points} startRemaining={0} currentRemaining={0} metricMode="points" isDark={false} />);

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
  });

  it("shows remaining over scope in points, with the ideal and actual lines", () => {
    const { container } = renderEn(
      <BurndownChart points={points} startRemaining={10} currentRemaining={7} metricMode="points" isDark={false} />
    );

    expect(screen.getByText("Remaining / Scope")).toBeInTheDocument();
    expect(screen.getByText(/^7 \/ 10/)).toHaveTextContent("7 / 10 pts");
    expect(legend(container)).toEqual({ "Ideal Burndown": "#94a3b8", "Remaining Points": "#6366f1" });
    expect(xTicks(container)).toEqual(["Nov 1", "Nov 2"]);
  });

  it("labels the header in cards in cards mode", () => {
    renderEn(<BurndownChart points={points} startRemaining={4} currentRemaining={3} metricMode="cards" isDark={false} />);

    expect(screen.getByText(/^3 \/ 4/)).toHaveTextContent("3 / 4 cards");
  });
});

describe("CycleTimeChart", () => {
  function record(cardNumber: number): CycleTimeRecord {
    return {
      cardId: `c${cardNumber}`,
      cardNumber,
      title: `Card ${cardNumber}`,
      leadTimeDays: 4,
      cycleTimeDays: 2,
      completedAt: `2026-11-${String(cardNumber).padStart(2, "0")}T00:00:00Z`,
    };
  }

  function summary(records: CycleTimeRecord[]): CycleTimeSummary {
    return { avgLeadTimeDays: 4.2, avgCycleTimeDays: 2.1, medianCycleTimeDays: 1.8, completedCount: records.length, records };
  }

  it("shows the empty state and no stats with no completed cards", () => {
    renderEn(<CycleTimeChart summary={summary([])} isDark={false} />);

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(screen.queryByText("Median Cycle Time:")).toBeNull();
  });

  it("shows average cycle, average lead and median cycle time", () => {
    renderEn(<CycleTimeChart summary={summary([record(1)])} isDark={false} />);

    expect(screen.getByText("2.1 days")).toBeInTheDocument();
    expect(screen.getByText("4.2 days")).toBeInTheDocument();
    expect(screen.getByText("1.8 days")).toBeInTheDocument();
  });

  it("plots cycle and lead time for only the 15 most recent cards", () => {
    const records = Array.from({ length: 20 }, (_, i) => record(i + 1));
    const { container } = renderEn(<CycleTimeChart summary={summary(records)} isDark={false} />);

    expect(xTicks(container)).toEqual(records.slice(5).map((r) => `#${r.cardNumber}`));
    expect(legend(container)).toEqual({ "Avg Cycle Time": "#f59e0b", "Avg Lead Time": "#94a3b8" });
  });
});

describe("CumulativeFlowChart", () => {
  const columns = [
    { id: "a", name: "Backlog", isDone: false },
    { id: "b", name: "Doing", isDone: false },
    { id: "c", name: "Shipped", isDone: true },
  ];
  const points: CumulativeFlowPoint[] = [
    { date: "2026-11-01", label: "Nov 1", Backlog: 4, Doing: 1, Shipped: 0 },
    { date: "2026-11-02", label: "Nov 2", Backlog: 2, Doing: 2, Shipped: 1 },
  ];

  it("shows the empty state with no points", () => {
    renderEn(<CumulativeFlowChart points={[]} columns={columns} metricMode="cards" isDark={false} />);

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
  });

  it("shows the empty state with no columns", () => {
    renderEn(<CumulativeFlowChart points={points} columns={[]} metricMode="cards" isDark={false} />);

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
  });

  it("stacks one area per column, with the done column in emerald and the rest from the palette", () => {
    const { container } = renderEn(<CumulativeFlowChart points={points} columns={columns} metricMode="cards" isDark={false} />);

    expect(legend(container)).toEqual({ Backlog: "#64748b", Doing: "#3b82f6", Shipped: "#10b981" });
    expect(xTicks(container)).toEqual(["Nov 1", "Nov 2"]);
    expect(screen.getByText("Cards")).toBeInTheDocument();
  });

  it("labels the axis in points in points mode", () => {
    renderEn(<CumulativeFlowChart points={points} columns={columns} metricMode="points" isDark={false} />);

    expect(screen.getByText("Points")).toBeInTheDocument();
  });
});
