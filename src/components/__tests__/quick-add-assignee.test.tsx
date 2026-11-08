import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import KanbanColumn from "../KanbanColumn";
import CardDetailModal from "../CardDetailModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { createCard } from "@/actions/cards";
import { en } from "@/locales/en";

vi.mock("@/actions/cards", () => ({
  createCard: vi.fn(async () => ({ success: true, data: {} })),
  updateCard: vi.fn(async () => ({ success: true, data: {} })),
  deleteCard: vi.fn(async () => ({ success: true })),
  archiveCard: vi.fn(async () => ({ success: true })),
  getCardByIdentifier: vi.fn(async () => ({ success: false })),
  addCardLink: vi.fn(async () => ({ success: true, data: {} })),
  removeCardLink: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/projects", () => ({
  getProjectById: vi.fn(async () => ({ success: true, data: { key: "TST", columns: [] } })),
}));
vi.mock("@/actions/comments", () => ({
  addComment: vi.fn(async () => ({ success: true, data: {} })),
  updateComment: vi.fn(async () => ({ success: true, data: {} })),
  deleteComment: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/activity", () => ({ getCardActivity: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock("@/actions/attachments", () => ({
  uploadAttachment: vi.fn(async () => ({ success: true, data: {} })),
  listAttachments: vi.fn(async () => ({ success: true, data: [] })),
  deleteAttachment: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/labels", () => ({ getLabels: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock("@/actions/cardTypes", () => ({ getCardTypes: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock("@/actions/relations", () => ({
  addCardRelation: vi.fn(async () => ({ success: true })),
  removeCardRelation: vi.fn(async () => ({ success: true })),
  getCardRelations: vi.fn(async () => ({ success: true, data: [] })),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

const members = [
  { userId: "u1", role: "OWNER", user: { id: "u1", name: "Ada Lovelace", email: "ada@example.invalid" } },
  { userId: "u2", role: "MEMBER", user: { id: "u2", name: "", email: "grace@example.invalid" } },
];

const column = { id: "col1", projectId: "p1", name: "To Do", order: 0, cards: [] };

function quickAdd(title: string, assignee: string) {
  renderWithProviders(
    <KanbanColumn
      column={column}
      members={members}
      onCardClick={vi.fn()}
      onRefresh={vi.fn()}
      onDragStartCard={vi.fn()}
      onDropCard={vi.fn()}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: en.kanban.addCard })[0]);
  fireEvent.change(screen.getByPlaceholderText(en.kanban.taskTitlePlaceholder), { target: { value: title } });
  fireEvent.change(screen.getByRole("combobox", { name: en.cardModal.owner }), { target: { value: assignee } });
  fireEvent.submit(screen.getByPlaceholderText(en.kanban.taskTitlePlaceholder).closest("form")!);
}

describe("board quick-add assignee", () => {
  beforeEach(() => {
    vi.mocked(createCard).mockClear();
  });

  it("offers the project's members instead of a free-text name", () => {
    quickAdd("x", "");

    const select = screen.getByRole("combobox", { name: en.cardModal.owner });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      en.cardModal.unassigned,
      "Ada Lovelace",
      "grace@example.invalid",
    ]);
    expect(screen.queryByPlaceholderText(/assignee name/i)).toBeNull();
  });

  it("sends the chosen member as the assignee, with their name as owner", async () => {
    quickAdd("Write docs", "u1");

    await waitFor(() => expect(createCard).toHaveBeenCalled());
    expect(vi.mocked(createCard).mock.calls[0][0]).toMatchObject({
      title: "Write docs",
      assigneeIds: ["u1"],
      owner: "Ada Lovelace",
    });
  });

  it("sends no assignee for Unassigned", async () => {
    quickAdd("Loose end", "");

    await waitFor(() => expect(createCard).toHaveBeenCalled());
    expect(vi.mocked(createCard).mock.calls[0][0]).toMatchObject({ assigneeIds: [], owner: null });
  });

  it("opens in the card modal with that member selected and no Legacy option", async () => {
    quickAdd("Write docs", "u2");
    await waitFor(() => expect(createCard).toHaveBeenCalled());
    const sent = vi.mocked(createCard).mock.calls[0][0];

    const created = {
      id: "card1",
      projectId: "p1",
      columnId: "col1",
      title: sent.title,
      description: null,
      priority: "NONE",
      points: null,
      owner: sent.owner ?? null,
      dueDate: null,
      typeId: null,
      labels: [],
      comments: [],
      activities: [],
      links: [],
      assignees: (sent.assigneeIds ?? []).map((id) => ({ user: members.find((m) => m.user.id === id)!.user })),
    };
    renderWithProviders(
      <CardDetailModal card={created} columns={[{ id: "col1", name: "To Do" }]} members={members} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    const modalSelect = screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "u2");
    expect(modalSelect).toBeDefined();
    expect(screen.queryByText(/\(Legacy\)/)).toBeNull();
  });
});
