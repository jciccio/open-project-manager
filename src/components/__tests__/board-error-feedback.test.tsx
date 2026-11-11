import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import KanbanBoard from "../KanbanBoard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { en } from "@/locales/en";

const reorderCards = vi.hoisted(() => vi.fn());

vi.mock("../CardDetailModal", () => ({ default: () => null }));
vi.mock("@/actions/cards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/actions/cards")>()),
  reorderCards,
}));

function card(id: string, title: string) {
  return { id, title, description: null, priority: "MEDIUM", points: null, owner: null, dueDate: null, labels: [], comments: [] };
}

const project = {
  id: "p1",
  name: "Feedback",
  color: "#6366f1",
  isArchived: false,
  savedViews: [],
  cardTypes: [],
  members: [],
  columns: [
    { id: "todo", projectId: "p1", name: "To Do", order: 0, group: "UNSTARTED", isDone: false, cards: [card("c1", "Task one")] },
    { id: "doing", projectId: "p1", name: "Doing", order: 1, group: "STARTED", isDone: false, cards: [] },
  ],
};

function dropTaskOneOnDoing() {
  const column = screen.getByRole("heading", { name: "Doing" }).closest("[class*='w-80']")!;
  fireEvent.drop(column, {
    dataTransfer: { getData: () => JSON.stringify({ cardId: "c1", sourceColumnId: "todo" }), setData: vi.fn() },
  });
}

function renderBoard() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <KanbanBoard project={project as any} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

describe("board mutation feedback", () => {
  beforeEach(() => {
    reorderCards.mockReset();
  });

  it("shows the server's error on the board when a drag is refused", async () => {
    reorderCards.mockResolvedValue({ success: false, error: "Unauthorized or card not found" });
    renderBoard();

    dropTaskOneOnDoing();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized or card not found");
  });

  it("shows a fallback when the drop itself fails", async () => {
    reorderCards.mockImplementation(async () => {
      throw new Error("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderBoard();

    dropTaskOneOnDoing();

    expect(await screen.findByRole("alert")).toHaveTextContent(en.kanban.actionFailed);
  });

  it("clears the error once a later drag succeeds", async () => {
    reorderCards.mockResolvedValueOnce({ success: false, error: "Unauthorized or card not found" });
    reorderCards.mockResolvedValueOnce({ success: true });
    renderBoard();

    dropTaskOneOnDoing();
    await screen.findByRole("alert");
    dropTaskOneOnDoing();

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
