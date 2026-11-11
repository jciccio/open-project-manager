import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CardDetailModal from "../CardDetailModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { updateCard, addCardLink } from "@/actions/cards";
import { addComment, listComments } from "@/actions/comments";

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
  listComments: vi.fn(async () => ({ success: true, data: [] })),
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

    const descriptionTextarea = (document.getElementById("card-description-editor") || document.querySelector("textarea")) as HTMLTextAreaElement;
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

  it("renders loaded comments and updates comment badge", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      success: true,
      data: [
        { id: "c1", author: "Bob", content: "Loaded comment 1", createdAt: new Date().toISOString() },
      ],
    } as never);

    const card = buildCard({ _count: { comments: 1 } });
    renderWithProviders(<CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />);

    expect(await screen.findByText("Loaded comment 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comments/i })).toHaveTextContent("1");
  });

  it("handles comment loading error gracefully and preserves count badge", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      success: false,
      error: "Failed to fetch comments from server",
    } as never);

    const card = buildCard({ _count: { comments: 3 } });
    renderWithProviders(<CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />);

    expect(await screen.findByText("Failed to load comments.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comments/i })).toHaveTextContent("3");
    expect(screen.queryByText("Loading comments...")).not.toBeInTheDocument();
    expect(screen.queryByText("No comments yet.")).not.toBeInTheDocument();
  });

  it("does not render a free-text author input and displays authorUser name", async () => {
    const commentsData = [
      {
        id: "c-modern",
        author: "Legacy Name",
        authorUser: { id: "u1", name: "Verified User", email: "v@example.com" },
        content: "Comment with FK",
        createdAt: new Date().toISOString(),
      },
      {
        id: "c-legacy",
        author: "Old Author",
        authorUser: null,
        content: "Legacy comment",
        createdAt: new Date().toISOString(),
      },
    ];

    vi.mocked(listComments).mockResolvedValueOnce({
      success: true,
      data: commentsData,
    } as never);

    const card = {
      ...buildCard(),
      comments: commentsData,
    };

    renderWithProviders(
      <CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    // Free-text author input should no longer exist
    expect(screen.queryByPlaceholderText("Your Name (Optional)")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Write a comment...")).toBeInTheDocument();

    // Verify attribution display
    expect(await screen.findByText("Verified User")).toBeInTheDocument();
    expect(await screen.findByText("Old Author")).toBeInTheDocument();
  });

  it("displays _count.comments rather than card.comments.length before full comments finish loading", async () => {
    let resolveComments!: (value: unknown) => void;
    vi.mocked(listComments).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveComments = resolve;
      }) as never
    );

    const card = buildCard({
      comments: [
        { id: "c-inline", author: "Bob", content: "Inline only", createdAt: new Date().toISOString() },
      ],
      _count: { comments: 5 },
    });
    renderWithProviders(
      <CardDetailModal card={card} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /comments/i })).toHaveTextContent("5");
    resolveComments({ success: true, data: [] });
    await waitFor(() => expect(listComments).toHaveBeenCalled());
  });

  it("keeps a comment posted during initial load at the top above fetched snapshot comments", async () => {
    let resolveComments!: (value: unknown) => void;
    vi.mocked(listComments).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveComments = resolve;
      }) as never
    );
    vi.mocked(addComment).mockResolvedValueOnce({
      success: true,
      data: {
        id: "c-posted-early",
        author: "Alice",
        content: "Posted while loading",
        createdAt: new Date().toISOString(),
      },
    } as never);

    renderWithProviders(
      <CardDetailModal card={buildCard()} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    fireEvent.change(screen.getByPlaceholderText("Write a comment..."), {
      target: { value: "Posted while loading" },
    });
    fireEvent.click(screen.getByRole("button", { name: /post/i }));

    await waitFor(() => expect(addComment).toHaveBeenCalledWith("card1", "Posted while loading"));

    resolveComments({
      success: true,
      data: [
        {
          id: "c-snapshot",
          author: "Bob",
          content: "Older snapshot comment",
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });

    const earlyComment = await screen.findByText("Posted while loading");
    const snapshotComment = await screen.findByText("Older snapshot comment");
    expect(earlyComment).toBeInTheDocument();
    expect(
      earlyComment.compareDocumentPosition(snapshotComment) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  it("clears commentsError when posting a comment after initial comment load fails", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      success: false,
      error: "Failed to load",
    } as never);
    vi.mocked(addComment).mockResolvedValueOnce({
      success: true,
      data: {
        id: "c-after-fail",
        author: "Alice",
        content: "Recovered comment",
        createdAt: new Date().toISOString(),
      },
    } as never);

    renderWithProviders(
      <CardDetailModal card={buildCard({ _count: { comments: 2 } })} columns={columns} onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    expect(await screen.findByText("Failed to load comments.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Write a comment..."), {
      target: { value: "Recovered comment" },
    });
    fireEvent.click(screen.getByRole("button", { name: /post/i }));

    expect(await screen.findByText("Recovered comment")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load comments.")).not.toBeInTheDocument();
  });
});
