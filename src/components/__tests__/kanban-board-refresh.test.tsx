import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import KanbanBoard from "../KanbanBoard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("../CardDetailModal", () => ({
  default: ({ card, onClose }: { card: { comments?: Array<unknown> }; onClose: () => void }) => (
    <div data-testid="card-detail-modal">
      <span data-testid="modal-comment-count">{card.comments?.length ?? 0}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

function buildProject(cardComments: Array<unknown>) {
  return {
    id: "p1",
    name: "Test Project",
    color: "#6366f1",
    isArchived: false,
    savedViews: [],
    cardTypes: [],
    columns: [
      {
        id: "col1",
        name: "To Do",
        cards: [
          {
            id: "card1",
            title: "Task One",
            description: null,
            priority: "MEDIUM",
            points: null,
            owner: null,
            dueDate: null,
            labels: [],
            comments: cardComments,
          },
        ],
      },
    ],
  };
}

describe("KanbanBoard activeCard reactivity", () => {
  it("re-derives the open card from a refreshed project prop instead of showing a stale snapshot", () => {
    const initialProject = buildProject([]);
    const { rerender } = renderWithProviders(<KanbanBoard project={initialProject} />);

    fireEvent.click(screen.getByText("Task One"));
    expect(screen.getByTestId("card-detail-modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal-comment-count").textContent).toBe("0");

    const refreshedProject = buildProject([
      { id: "c1", author: "Alice", content: "New comment", createdAt: new Date() },
    ]);
    rerender(
      <ThemeProvider>
        <LanguageProvider>
          <KanbanBoard project={refreshedProject} />
        </LanguageProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId("modal-comment-count").textContent).toBe("1");
  });

  it("closes the modal when the active card disappears from a refreshed project", () => {
    const initialProject = buildProject([]);
    const { rerender } = renderWithProviders(<KanbanBoard project={initialProject} />);

    fireEvent.click(screen.getByText("Task One"));
    expect(screen.getByTestId("card-detail-modal")).toBeInTheDocument();

    const emptyProject = { ...initialProject, columns: [{ ...initialProject.columns[0], cards: [] }] };
    rerender(
      <ThemeProvider>
        <LanguageProvider>
          <KanbanBoard project={emptyProject} />
        </LanguageProvider>
      </ThemeProvider>
    );

    expect(screen.queryByTestId("card-detail-modal")).not.toBeInTheDocument();
  });
});
