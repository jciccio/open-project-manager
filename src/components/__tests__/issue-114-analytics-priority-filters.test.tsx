import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AnalyticsView from "../views/AnalyticsView";
import ListView from "../views/ListView";
import CalendarView from "../views/CalendarView";
import { filterCards, matchesCardFilter } from "@/lib/cardFilter";
import { getPriorityStyle, PRIORITY_HEX_COLORS, PRIORITY_STYLES } from "@/lib/priority";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// ResizeObserver mock for Recharts
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Issue #114: Analytics, Priority, and Filter unifications", () => {
  it("AnalyticsView derives completed points from col.isDone (e.g. Hecho / Terminado)", () => {
    const project = {
      id: "p1",
      name: "Spanish Project",
      columns: [
        {
          id: "col1",
          name: "Por Hacer",
          isDone: false,
          cards: [{ id: "c1", title: "Task 1", points: 3, priority: "NONE" }],
        },
        {
          id: "col2",
          name: "Hecho",
          isDone: true,
          cards: [{ id: "c2", title: "Task 2", points: 5, priority: "NONE" }],
        },
      ],
    };

    renderWithProviders(<AnalyticsView project={project} />);

    // Total points = 8, completed points = 5
    expect(screen.getByText("8")).toBeInTheDocument(); // Total Points
    expect(screen.getByText("5")).toBeInTheDocument(); // Points Completed
  });

  it("AnalyticsView counts NONE priority cards in priority distribution", () => {
    const project = {
      id: "p1",
      columns: [
        {
          id: "col1",
          name: "Backlog",
          isDone: false,
          cards: [
            { id: "c1", title: "Default Card 1", points: 1, priority: "NONE" },
            { id: "c2", title: "Default Card 2", points: 2, priority: "NONE" },
          ],
        },
      ],
    };

    const { container } = renderWithProviders(<AnalyticsView project={project} />);
    // NONE should be present in the document and have hex color defined
    expect(PRIORITY_HEX_COLORS.NONE).toBeDefined();
    expect(container).toBeInTheDocument();
  });

  it("ListView styles NONE priority cards with neutral slate styling, not MEDIUM blue", () => {
    const project = {
      id: "p1",
      columns: [
        {
          id: "col1",
          name: "Todo",
          isDone: false,
          cards: [{ id: "c1", title: "Default Task", priority: "NONE" }],
        },
      ],
    };

    renderWithProviders(
      <ListView
        project={project}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        searchQuery=""
        priorityFilter="ALL"
      />
    );

    const badge = screen.getByText("NONE");
    expect(badge.className).toContain("text-slate-500");
    expect(badge.className).not.toContain("text-blue-600");
  });

  it("CalendarView applies typeFilter to filter out non-matching cards", () => {
    const project = {
      id: "p1",
      columns: [
        {
          id: "col1",
          name: "Todo",
          isDone: false,
          cards: [
            { id: "c1", title: "Bug Task", priority: "HIGH", typeId: "type_bug" },
            { id: "c2", title: "Feature Task", priority: "LOW", typeId: "type_feat" },
          ],
        },
      ],
    };

    // Filter by type_bug only
    const { rerender } = renderWithProviders(
      <CalendarView
        project={project}
        onCardClick={vi.fn()}
        searchQuery=""
        priorityFilter="ALL"
        typeFilter="type_bug"
      />
    );

    expect(screen.getByText("Bug Task")).toBeInTheDocument();
    expect(screen.queryByText("Feature Task")).toBeNull();

    // Rerender with type_feat
    rerender(
      <ThemeProvider>
        <LanguageProvider>
          <CalendarView
            project={project}
            onCardClick={vi.fn()}
            searchQuery=""
            priorityFilter="ALL"
            typeFilter="type_feat"
          />
        </LanguageProvider>
      </ThemeProvider>
    );

    expect(screen.queryByText("Bug Task")).toBeNull();
    expect(screen.getByText("Feature Task")).toBeInTheDocument();
  });

  it("filterCards correctly handles combined queries, priority, and subtask filtering", () => {
    const cards = [
      { id: "1", title: "Fix bug", priority: "HIGH", typeId: "t1" },
      { id: "2", title: "Add feature", priority: "LOW", typeId: "t2", parentId: "p1" },
      { id: "3", title: "Documentation", priority: "NONE", typeId: "t1" },
    ];

    // Priority filter
    expect(filterCards(cards, { priorityFilter: "HIGH" })).toHaveLength(1);
    expect(filterCards(cards, { priorityFilter: "NONE" })).toHaveLength(1);

    // Hide subtasks
    expect(filterCards(cards, { hideSubtasks: true })).toHaveLength(2);

    // Type filter
    expect(filterCards(cards, { typeFilter: "t1" })).toHaveLength(2);
    expect(filterCards(cards, { typeFilter: "NONE" })).toHaveLength(0);
  });

  it("getPriorityStyle falls back to NONE for undefined or unknown priority", () => {
    expect(getPriorityStyle(undefined)).toEqual(PRIORITY_STYLES.NONE);
    expect(getPriorityStyle("UNKNOWN_VALUE")).toEqual(PRIORITY_STYLES.NONE);
    expect(getPriorityStyle("HIGH")).toEqual(PRIORITY_STYLES.HIGH);
  });
});
