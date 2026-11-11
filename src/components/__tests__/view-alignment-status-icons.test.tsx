import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ListView from "../views/ListView";
import KanbanBoard from "../KanbanBoard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

const mockProject = {
  id: "p1",
  name: "Test Project",
  color: "#6366f1",
  visibility: "PRIVATE",
  isArchived: false,
  members: [],
  cardTypes: [],
  columns: [
    {
      id: "col-1",
      name: "In Progress",
      group: "STARTED",
      isDone: false,
      color: "#eab308",
      order: 0,
      cards: [],
    },
    {
      id: "col-2",
      name: "Done",
      group: "COMPLETED",
      isDone: true,
      color: "#10b981",
      order: 1,
      cards: [],
    },
  ],
};

describe("View tabs alignment and status icons (#291)", () => {
  it("ListView renders ColumnGroupIcon for each column header", () => {
    const { container } = renderWithProviders(
      <ListView
        project={mockProject}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        searchQuery=""
        priorityFilter="ALL"
      />
    );

    const startedIcon = container.querySelector('[data-group="STARTED"]');
    expect(startedIcon).toBeInTheDocument();

    const completedIcon = container.querySelector('[data-group="COMPLETED"]');
    expect(completedIcon).toBeInTheDocument();
  });

  it("KanbanBoard keeps the filter container rendered with invisible on Analytics view", () => {
    const { container } = renderWithProviders(<KanbanBoard project={mockProject} />);

    // Initially on Kanban view, filter container is visible (not invisible)
    const filterInput = screen.getByPlaceholderText(/search/i);
    expect(filterInput.closest(".invisible")).toBeNull();

    // Click on Analytics tab
    const analyticsTab = screen.getByRole("button", { name: /analytics/i });
    fireEvent.click(analyticsTab);

    // Filter container should still exist in DOM to preserve space, but have invisible class and aria-hidden
    const filterContainer = filterInput.closest(".invisible");
    expect(filterContainer).toBeInTheDocument();
    expect(filterContainer).toHaveAttribute("aria-hidden", "true");
  });
});
