import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CardDetailModal from "../CardDetailModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { updateCard, addCardLink } from "@/actions/cards";
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

  it("shows the server error and keeps the form open when adding a link is rejected", async () => {
    vi.mocked(addCardLink).mockResolvedValueOnce({
      success: false,
      error: "Link URL must be a valid http, https or mailto URL",
    } as never);
    renderWithProviders(<CardDetailModal card={buildCard()} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByText("Add Link"));
    const urlInput = screen.getByPlaceholderText("https://...") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(urlInput.closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link URL must be a valid http, https or mailto URL");
    expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();

    fireEvent.change(urlInput, { target: { value: "https://example.com" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a stored javascript: link without an href", () => {
    const card = buildCard({
      links: [
        { id: "l1", url: "javascript:alert(1)", title: "Bad link" },
        { id: "l2", url: "https://example.com", title: "Good link" },
      ],
    });
    renderWithProviders(<CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />);

    expect(screen.getByText("Bad link").closest("a")).not.toHaveAttribute("href");
    expect(screen.getByText("Good link").closest("a")).toHaveAttribute("href", "https://example.com");
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

    // The owner field is a member picker now; a card whose owner predates
    // project members shows that name as a "(Legacy)" option, and clearing it
    // means switching to Unassigned.
    const ownerSelect = Array.from(document.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.textContent === "Unassigned")
    ) as HTMLSelectElement;
    expect(ownerSelect.value).not.toBe("");
    fireEvent.change(ownerSelect, { target: { value: "" } });

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
