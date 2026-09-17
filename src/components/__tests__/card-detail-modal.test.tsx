import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CardDetailModal from "../CardDetailModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { updateCard } from "@/actions/cards";
import { addComment } from "@/actions/comments";

vi.mock("@/actions/cards", () => ({
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
  addComment: vi.fn(async () => ({
    success: true,
    data: { id: "c2", author: "Team Member", content: "New comment", createdAt: new Date().toISOString() },
  })),
  updateComment: vi.fn(async () => ({ success: true, data: {} })),
  deleteComment: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/activity", () => ({
  getCardActivity: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/attachments", () => ({
  uploadAttachment: vi.fn(async () => ({ success: true, data: {} })),
  listAttachments: vi.fn(async () => ({ success: true, data: [] })),
  deleteAttachment: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/labels", () => ({
  getLabels: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/cardTypes", () => ({
  getCardTypes: vi.fn(async () => ({ success: true, data: [] })),
}));

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

function buildCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "card1",
    projectId: "p1",
    columnId: "col1",
    title: "Original Title",
    description: "Original description",
    priority: "MEDIUM",
    points: null,
    owner: "Alice",
    dueDate: "2026-12-01",
    typeId: null,
    labels: [],
    comments: [],
    activities: [],
    links: [],
    ...overrides,
  };
}

const columns = [{ id: "col1", name: "To Do" }];

describe("CardDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps in-progress title edits across a background project refresh", async () => {
    const card = buildCard();
    const { rerender } = renderWithProviders(
      <CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    const titleInput = screen.getByPlaceholderText("Card Title...") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Edited title in progress" } });
    expect(titleInput.value).toBe("Edited title in progress");

    // Simulate router.refresh() bringing a fresh card object (e.g. a label added elsewhere)
    // for the SAME card while the modal stays mounted.
    const refreshedCard = buildCard({ labels: [{ label: { id: "l1", name: "Bug", color: "#f00" } }] });
    rerender(
      <ThemeProvider>
        <LanguageProvider>
          <CardDetailModal card={refreshedCard} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
        </LanguageProvider>
      </ThemeProvider>
    );

    expect(titleInput.value).toBe("Edited title in progress");
  });

  it("shows a newly posted comment immediately without waiting for onRefresh", async () => {
    const card = buildCard();
    renderWithProviders(
      <CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    const commentInput = screen.getByPlaceholderText("Write a comment...");
    fireEvent.change(commentInput, { target: { value: "New comment" } });
    fireEvent.click(screen.getByText("Post"));

    await waitFor(() => expect(addComment).toHaveBeenCalled());
    expect(await screen.findByText("New comment")).toBeInTheDocument();
  });

  it("sends null (not omitted) when description, owner, and due date are cleared", async () => {
    const card = buildCard();
    renderWithProviders(
      <CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Alex Rivera"), {
      target: { value: "" },
    });

    const descriptionTextarea = document.getElementById("markdown-editor-textarea") as HTMLTextAreaElement;
    fireEvent.change(descriptionTextarea, { target: { value: "" } });

    const dueDateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dueDateInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(updateCard).toHaveBeenCalled());
    const payload = vi.mocked(updateCard).mock.calls[0][1];
    expect(payload.description).toBeNull();
    expect(payload.owner).toBeNull();
    expect(payload.dueDate).toBeNull();
  });
});
