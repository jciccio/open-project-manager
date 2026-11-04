import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import KanbanBoard from "../KanbanBoard";
import KanbanColumn from "../KanbanColumn";
import Header from "../Header";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import * as cardsActions from "@/actions/cards";

vi.mock("@/actions/cards", () => ({
  moveCard: vi.fn(async () => ({ success: true })),
  reorderCards: vi.fn(async () => ({ success: true })),
  createCard: vi.fn(async () => ({ success: true, data: { id: "new-card" } })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

function fireDragOverWithClientY(element: HTMLElement, clientY: number) {
  const event = createEvent.dragOver(element);
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(element, event);
}

function fireDropWithClientY(element: HTMLElement, clientY: number, data: any) {
  const event = createEvent.drop(element);
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      getData: () => JSON.stringify(data),
      types: ["text/plain"],
    },
  });
  fireEvent(element, event);
}

describe("Intra-column card reordering and UI improvements (#132)", () => {
  let rectSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 150,
      height: 50,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  const mockProject = {
    id: "p1",
    name: "Project 1",
    color: "#6366f1",
    isArchived: false,
    savedViews: [],
    cardTypes: [],
    columns: [
      {
        id: "col-todo",
        projectId: "p1",
        name: "To Do",
        order: 1,
        cards: [
          { id: "c1", title: "Card 1", order: 10000, priority: "MEDIUM" },
          { id: "c2", title: "Card 2", order: 20000, priority: "HIGH" },
          { id: "c3", title: "Card 3", order: 30000, priority: "LOW" },
        ],
      },
      {
        id: "col-done",
        projectId: "p1",
        name: "Done",
        order: 2,
        isDone: true,
        cards: [
          { id: "c4", title: "Card 4", order: 10000, priority: "NONE" },
        ],
      },
    ],
  };

  it("Header uses flex-wrap and accessible logo alt text without hardcoded clipping", () => {
    const { container } = renderWithProviders(
      <Header user={{ userId: "u1", email: "user@example.com", name: "Alice" }} />
    );

    const logoImg = screen.getByAltText("Open Project Manager Logo");
    expect(logoImg).toBeInTheDocument();

    const maxWContainer = container.querySelector(".max-w-7xl");
    expect(maxWContainer?.className).toContain("flex-wrap");

    const actionsContainer = container.querySelector(".justify-end");
    expect(actionsContainer?.className).toContain("flex-wrap");
  });

  it("KanbanColumn avoids drag flicker using drag counter and calculates drop position", () => {
    const onDropCard = vi.fn();
    const col = mockProject.columns[0];

    const { container } = renderWithProviders(
      <KanbanColumn
        column={col}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        onDragStartCard={vi.fn()}
        onDropCard={onDropCard}
      />
    );

    const columnRoot = container.querySelector(".w-80") as HTMLElement;

    // Simulate drag enter on column
    fireEvent.dragEnter(columnRoot, { dataTransfer: { types: ["text/plain"] } });
    expect(columnRoot.className).toContain("border-indigo-500/50");

    // Drag enter on child element should increment counter and keep hover active
    fireEvent.dragEnter(columnRoot, { dataTransfer: { types: ["text/plain"] } });
    expect(columnRoot.className).toContain("border-indigo-500/50");

    // Drag leave once (e.g., from child) does not reset highlight because counter > 0
    fireEvent.dragLeave(columnRoot, { relatedTarget: columnRoot.firstElementChild });
    expect(columnRoot.className).toContain("border-indigo-500/50");

    // Drag leave again clears highlight
    fireEvent.dragLeave(columnRoot, { relatedTarget: null });
    expect(columnRoot.className).not.toContain("border-indigo-500/50");

    // Test card drag over upper half (clientY=110 < 125) -> dropPosition "before"
    let card2Element = screen.getByText("Card 2").closest("[draggable]") as HTMLElement;
    fireDragOverWithClientY(card2Element, 110);
    card2Element = screen.getByText("Card 2").closest("[draggable]") as HTMLElement;
    expect(card2Element.className).toContain("border-t-2");

    // Drop on upper half calls onDropCard with "before"
    fireDropWithClientY(card2Element, 110, { cardId: "c3", sourceColumnId: "col-todo" });
    expect(onDropCard).toHaveBeenCalledWith(
      expect.anything(),
      "col-todo",
      "c2",
      "before"
    );

    // Hover on lower half (clientY=140 > 125) -> dropPosition "after"
    card2Element = screen.getByText("Card 2").closest("[draggable]") as HTMLElement;
    fireDragOverWithClientY(card2Element, 140);
    card2Element = screen.getByText("Card 2").closest("[draggable]") as HTMLElement;
    expect(card2Element.className).toContain("border-b-2");

    fireDropWithClientY(card2Element, 140, { cardId: "c1", sourceColumnId: "col-todo" });
    expect(onDropCard).toHaveBeenCalledWith(
      expect.anything(),
      "col-todo",
      "c2",
      "after"
    );
  });

  it("KanbanBoard reorders cards within the same column and repacks sequential orders", async () => {
    renderWithProviders(<KanbanBoard project={mockProject} />);

    const card2Element = screen.getByText("Card 2").closest("[draggable]") as HTMLElement;

    // Drag Card 1 (index 0) and drop "after" Card 2 (index 1)
    // Resulting list should be: Card 2 (10000), Card 1 (20000), Card 3 (30000)
    fireDragOverWithClientY(card2Element, 140);
    fireDropWithClientY(card2Element, 140, { cardId: "c1", sourceColumnId: "col-todo" });

    expect(cardsActions.reorderCards).toHaveBeenCalledWith([
      { id: "c2", order: 10000, columnId: "col-todo" },
      { id: "c1", order: 20000, columnId: "col-todo" },
      { id: "c3", order: 30000, columnId: "col-todo" },
    ]);
  });

  it("KanbanBoard dropping a card onto itself in the same column is a no-op", async () => {
    renderWithProviders(<KanbanBoard project={mockProject} />);

    const card1Element = screen.getByText("Card 1").closest("[draggable]") as HTMLElement;

    fireDragOverWithClientY(card1Element, 110);
    fireDropWithClientY(card1Element, 110, { cardId: "c1", sourceColumnId: "col-todo" });

    expect(cardsActions.reorderCards).not.toHaveBeenCalled();
  });

  it("KanbanBoard moving a card across columns repacks orders with new columnId", async () => {
    const { container } = renderWithProviders(<KanbanBoard project={mockProject} />);

    // Drop Card 1 from col-todo onto the Done column body
    const doneColumn = container.querySelectorAll(".w-80")[1];
    fireEvent.drop(doneColumn, {
      dataTransfer: {
        getData: () => JSON.stringify({ cardId: "c1", sourceColumnId: "col-todo" }),
      },
    });

    // Target col-done had c4, now receives c1 at the end
    expect(cardsActions.reorderCards).toHaveBeenCalledWith([
      { id: "c4", order: 10000, columnId: "col-done" },
      { id: "c1", order: 20000, columnId: "col-done" },
    ]);
  });
});
