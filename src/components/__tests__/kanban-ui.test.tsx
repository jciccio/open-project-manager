import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProjectCard from "../ProjectCard";
import TaskCard from "../TaskCard";
import KanbanColumn from "../KanbanColumn";
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

describe("Kanban & Project UI Components", () => {
  it("renders ProjectCard with name, description, and stats", () => {
    const mockProject = {
      id: "p1",
      name: "E-Commerce System",
      description: "Building new checkout funnel",
      color: "#6366f1",
      createdAt: new Date("2026-01-01"),
      _count: {
        cards: 12,
        columns: 4,
      },
    };

    renderWithProviders(<ProjectCard project={mockProject} />);

    expect(screen.getByText("E-Commerce System")).toBeInTheDocument();
    expect(screen.getByText("Building new checkout funnel")).toBeInTheDocument();
    expect(screen.getByText(/4\s+Columns/i)).toBeInTheDocument();
    expect(screen.getByText(/12\s+Cards/i)).toBeInTheDocument();
  });

  it("renders TaskCard with priority, points, owner, and labels", () => {
    const mockCard = {
      id: "c1",
      title: "Implement Stripe Webhooks",
      description: "Handle checkout.session.completed",
      priority: "HIGH",
      points: 8,
      owner: "Alice",
      dueDate: "2026-09-01",
      labels: [
        { label: { id: "l1", name: "Backend", color: "#3b82f6" } },
      ],
      comments: [{ id: "cm1", content: "Working on it" }],
    };

    const handleClick = vi.fn();

    renderWithProviders(<TaskCard card={mockCard} onClick={handleClick} />);

    expect(screen.getByText("Implement Stripe Webhooks")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("8 pts")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument(); // Alice avatar initial

    fireEvent.click(screen.getByText("Implement Stripe Webhooks"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders TaskCard with custom priority fallback and owner tooltip", () => {
    const mockCard = {
      id: "c2",
      title: "Unknown Priority Task",
      description: null,
      priority: "CRITICAL",
      points: null,
      dueDate: null,
      owner: "Alice",
      labels: [],
      comments: [],
    };

    renderWithProviders(<TaskCard card={mockCard} onClick={vi.fn()} />);

    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByTitle("Assigned to Alice")).toBeInTheDocument();
  });

  it("renders KanbanColumn move buttons when enabled", () => {
    const mockColumn = {
      id: "col1",
      projectId: "p1",
      name: "In Progress",
      order: 1,
      cards: [],
    };

    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();

    renderWithProviders(
      <KanbanColumn
        column={mockColumn}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        onDragStartCard={vi.fn()}
        onDropCard={vi.fn()}
        canMoveLeft={true}
        canMoveRight={true}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
      />
    );

    const leftBtn = screen.getByTitle("Move column left");
    const rightBtn = screen.getByTitle("Move column right");

    expect(leftBtn).toBeInTheDocument();
    expect(rightBtn).toBeInTheDocument();

    fireEvent.click(leftBtn);
    expect(onMoveLeft).toHaveBeenCalledTimes(1);

    fireEvent.click(rightBtn);
    expect(onMoveRight).toHaveBeenCalledTimes(1);
  });

  it("shows 'Drop cards here' when column is empty and isFiltered is false", () => {
    const mockColumn = {
      id: "col1",
      projectId: "p1",
      name: "Empty Column",
      order: 1,
      cards: [],
    };

    renderWithProviders(
      <KanbanColumn
        column={mockColumn}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        onDragStartCard={vi.fn()}
        onDropCard={vi.fn()}
        isFiltered={false}
      />
    );

    expect(screen.getByText("Drop cards here")).toBeInTheDocument();
    expect(screen.queryByText("No cards match")).not.toBeInTheDocument();
  });

  it("shows 'No cards match' and does not say 'Drop cards here' when isFiltered is true", () => {
    const mockColumn = {
      id: "col1",
      projectId: "p1",
      name: "Filtered Empty Column",
      order: 1,
      cards: [],
    };

    renderWithProviders(
      <KanbanColumn
        column={mockColumn}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        onDragStartCard={vi.fn()}
        onDropCard={vi.fn()}
        isFiltered={true}
      />
    );

    expect(screen.getByText("No cards match")).toBeInTheDocument();
    expect(screen.queryByText("Drop cards here")).not.toBeInTheDocument();
  });

  it("shows match count and 'No cards match' for filtered columns, while truly empty columns keep 'Drop cards here'", () => {
    const mockProject = {
      id: "p1",
      name: "Board Test",
      key: "BRD",
      columns: [
        {
          id: "col-1",
          name: "To Do",
          group: "UNSTARTED",
          order: 0,
          cards: [
            {
              id: "c1",
              title: "Alpha Task",
              number: 1,
              priority: "HIGH",
              projectId: "p1",
              columnId: "col-1",
            },
          ],
        },
        {
          id: "col-2",
          name: "In Review",
          group: "STARTED",
          order: 1,
          cards: [], // truly empty column
        },
      ],
      members: [],
      cardTypes: [],
      savedViews: [],
    };

    renderWithProviders(<KanbanBoard project={mockProject} />);

    // Initially no filter is active: col-1 shows "Alpha Task", col-2 shows "Drop cards here"
    expect(screen.getByText("Alpha Task")).toBeInTheDocument();
    expect(screen.getByText("Drop cards here")).toBeInTheDocument();
    expect(screen.queryByText(/matching card/i)).not.toBeInTheDocument();

    // Type a query that matches nothing
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "NonExistent" } });

    // Match count appears near the search box with status role for screen readers
    expect(screen.getByRole("status")).toHaveTextContent("0 matching cards");

    // Column 1 (which had cards) now shows "No cards match" instead of "Drop cards here"
    expect(screen.getByText("No cards match")).toBeInTheDocument();

    // Column 2 (which was originally empty) still shows "Drop cards here"
    expect(screen.getByText("Drop cards here")).toBeInTheDocument();

    // Change search to match Alpha Task
    fireEvent.change(searchInput, { target: { value: "Alpha" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 matching card");
    expect(screen.getByText("Alpha Task")).toBeInTheDocument();
  });

  it("does not show match count when only hideSubtasks is toggled", () => {
    const mockProject = {
      id: "p1",
      name: "Subtask Test",
      key: "SUB",
      columns: [
        {
          id: "col-1",
          name: "To Do",
          group: "UNSTARTED",
          order: 0,
          cards: [
            { id: "c1", title: "Parent Task", number: 1, priority: "NONE", projectId: "p1", columnId: "col-1" },
            { id: "c2", title: "Subtask", number: 2, parentId: "c1", priority: "NONE", projectId: "p1", columnId: "col-1" },
          ],
        },
      ],
      members: [],
      cardTypes: [],
      savedViews: [],
    };

    renderWithProviders(<KanbanBoard project={mockProject} />);

    // Toggle hide subtasks
    const hideBtn = screen.getByRole("button", { name: /hide subtasks/i });
    fireEvent.click(hideBtn);

    // Subtask is hidden, but match count indicator should NOT be shown because search/filter is not active
    expect(screen.queryByText(/matching card/i)).not.toBeInTheDocument();
  });

  it("counts matching subtasks in List view even when Hide subtasks is enabled", () => {
    const mockProject = {
      id: "p1",
      name: "List Count Test",
      key: "SUB",
      columns: [
        {
          id: "col-1",
          name: "To Do",
          group: "UNSTARTED",
          order: 0,
          cards: [
            { id: "c1", title: "Parent Task", number: 1, priority: "NONE", projectId: "p1", columnId: "col-1", labels: [], assignees: [] },
            { id: "c2", title: "Child Bug", number: 2, parentId: "c1", priority: "NONE", projectId: "p1", columnId: "col-1", labels: [], assignees: [] },
          ],
        },
      ],
      members: [],
      cardTypes: [],
      savedViews: [],
    };

    renderWithProviders(<KanbanBoard project={mockProject} />);

    // Switch to List view, toggle Hide subtasks, and search for the subtask
    fireEvent.click(screen.getByRole("button", { name: /^list$/i }));
    fireEvent.click(screen.getByRole("button", { name: /hide subtasks/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Child" } });

    expect(screen.getByRole("status")).toHaveTextContent("1 matching card");
    expect(screen.getByText("Child Bug")).toBeInTheDocument();
  });
});

