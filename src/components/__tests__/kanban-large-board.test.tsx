import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import KanbanBoard from "../KanbanBoard";
import TaskCard from "../TaskCard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

const reorderCards = vi.hoisted(() => vi.fn(async (_items: unknown[]) => ({ success: true })));

vi.mock("../CardDetailModal", () => ({ default: () => null }));
vi.mock("@/actions/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/actions/cards")>()),
  reorderCards,
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

function buildCard(id: string, title: string, description: string | null = null) {
  return {
    id,
    title,
    description,
    priority: "MEDIUM",
    points: null,
    owner: null,
    dueDate: null,
    labels: [],
    comments: [],
  };
}

function buildProject() {
  return {
    id: "p1",
    name: "Large Project",
    color: "#6366f1",
    isArchived: false,
    savedViews: [],
    cardTypes: [],
    columns: [
      { id: "open", projectId: "p1", name: "To Do", order: 0, group: "UNSTARTED", isDone: false, cards: [buildCard("c1", "Open task")] },
      { id: "done", projectId: "p1", name: "Done", order: 1, group: "COMPLETED", isDone: true, cards: [buildCard("c2", "Finished task"), buildCard("c3", "Other finished")] },
      { id: "dropped", projectId: "p1", name: "Dropped", order: 2, group: "CANCELLED", isDone: false, cards: [buildCard("c4", "Cancelled task")] },
    ],
  };
}

describe("large board rendering", () => {
  it("renders a description as plain text with no markdown elements", () => {
    const card = {
      ...buildCard("c1", "Task"),
      description: "**Bold** with `code` and [a link](https://example.com)",
    };

    const { container } = renderWithProviders(<TaskCard card={card as never} onClick={vi.fn()} />);

    expect(screen.getByText("Bold with code and a link")).toBeInTheDocument();
    expect(container.querySelector("a, code, strong")).toBeNull();
  });

  it("starts completed and cancelled columns collapsed behind their count", () => {
    renderWithProviders(<KanbanBoard project={buildProject()} />);

    expect(screen.getByText("Open task")).toBeInTheDocument();
    expect(screen.queryByText("Finished task")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelled task")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" }).nextElementSibling).toHaveTextContent("2");
  });

  it("shows and hides a closed column's cards with its toggle", () => {
    renderWithProviders(<KanbanBoard project={buildProject()} />);

    const [expandDone] = screen.getAllByRole("button", { name: "Show this column's cards" });
    fireEvent.click(expandDone);
    expect(screen.getByText("Finished task")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled task")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide this column's cards" }));
    expect(screen.queryByText("Finished task")).not.toBeInTheDocument();
  });

  it("shows search matches that live in a collapsed column", async () => {
    renderWithProviders(<KanbanBoard project={buildProject()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "other" } });

    await waitFor(() => expect(screen.getByText("Other finished")).toBeInTheDocument());
    expect(screen.queryByText("Finished task")).not.toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  it("still accepts a card dropped on a collapsed column", async () => {
    renderWithProviders(<KanbanBoard project={buildProject()} />);

    const collapsedColumn = screen.getByRole("heading", { name: "Done" }).closest("[class*='w-80']")!;
    const dataTransfer = {
      getData: () => JSON.stringify({ cardId: "c1", sourceColumnId: "open" }),
      setData: vi.fn(),
    };

    fireEvent.drop(collapsedColumn, { dataTransfer });

    await waitFor(() =>
      expect(reorderCards).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "c1", columnId: "done" })])
      )
    );
  });
});
