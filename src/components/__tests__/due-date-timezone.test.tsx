import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import TaskCard from "../TaskCard";
import ListView from "../views/ListView";
import CalendarView from "../views/CalendarView";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

// Due dates are stored as UTC midnight. A card due "2026-09-01" is
// 2026-09-01T00:00:00Z, which is 2026-08-31 18:00 in America/Costa_Rica
// (UTC-6) - exactly the west-of-UTC scenario the bug only shows up in.
describe("Due date timezone display", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Costa_Rica";
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TaskCard shows the due date's UTC calendar day, not the shifted local day", () => {
    const card = {
      id: "c1",
      title: "Ship release",
      description: null,
      priority: "NONE",
      points: null,
      owner: null,
      dueDate: "2026-09-01",
      labels: [],
      comments: [],
    };
    renderWithProviders(<TaskCard card={card} onClick={vi.fn()} />);

    expect(screen.getByText("Sep 1")).toBeInTheDocument();
    expect(screen.queryByText("Aug 31")).not.toBeInTheDocument();
  });

  it("ListView shows the due date's UTC calendar day, not the shifted local day", () => {
    const project = {
      columns: [
        {
          id: "col1",
          name: "To Do",
          cards: [{ id: "c1", title: "Ship release", priority: "NONE", dueDate: "2026-09-01" }],
        },
      ],
    };
    renderWithProviders(
      <ListView project={project} onCardClick={vi.fn()} onRefresh={vi.fn()} searchQuery="" priorityFilter="ALL" />
    );

    expect(screen.getByText("Sep 1")).toBeInTheDocument();
    expect(screen.queryByText("Aug 31")).not.toBeInTheDocument();
  });

  it("CalendarView places a due date in the correct UTC day cell, not one day early", () => {
    const project = {
      columns: [
        {
          id: "col1",
          name: "To Do",
          cards: [{ id: "c1", title: "Ship release", priority: "NONE", dueDate: "2026-09-01" }],
        },
      ],
    };
    // Viewing September 2026 - local midday, safely inside the target month
    // in both UTC and America/Costa_Rica so the visible month itself isn't
    // what's under test here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00-06:00"));

    const { container } = renderWithProviders(
      <CalendarView project={project} onCardClick={vi.fn()} searchQuery="" priorityFilter="ALL" />
    );

    // Sept 1, 2026 is a UTC Tuesday, so the days grid has 2 leading empty
    // cells before day 1 (grid[0] is the Sun-Sat header row).
    const daysGrid = container.querySelectorAll(".grid-cols-7")[1];
    const sep1Cell = daysGrid.children[2];
    const aug31EquivalentCell = daysGrid.children[1];

    expect(sep1Cell).toHaveTextContent("Ship release");
    expect(aug31EquivalentCell).not.toHaveTextContent("Ship release");
  });

  it("CalendarView highlights today using the same UTC calendar as due-date bucketing", () => {
    vi.useFakeTimers();
    // 2026-09-01T02:00:00Z is 2026-08-31 20:00 in America/Costa_Rica (UTC-6):
    // local calendar day is Aug 31, UTC calendar day is Sep 1.
    vi.setSystemTime(new Date("2026-09-01T02:00:00Z"));

    const project = { columns: [] };
    const { container } = renderWithProviders(
      <CalendarView project={project} onCardClick={vi.fn()} searchQuery="" priorityFilter="ALL" />
    );

    const daysGrid = container.querySelectorAll(".grid-cols-7")[1];
    const sep1Cell = daysGrid.children[2];
    expect(sep1Cell.className).toMatch(/indigo/);
  });
});
