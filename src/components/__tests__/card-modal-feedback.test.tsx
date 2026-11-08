import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CardDetailModal from "../CardDetailModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { updateCard } from "@/actions/cards";
import { deleteComment } from "@/actions/comments";
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
vi.mock("@/actions/members", () => ({ getProjectMembers: vi.fn(async () => ({ success: true, data: [] })) }));

const card = {
  id: "card1",
  projectId: "p1",
  columnId: "col1",
  title: "Original Title",
  description: null,
  priority: "MEDIUM",
  points: null,
  owner: null,
  dueDate: null,
  typeId: null,
  labels: [],
  comments: [{ id: "cm1", author: "Ada", content: "First comment", createdAt: new Date().toISOString() }],
  activities: [],
  links: [],
};

function renderModal() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <CardDetailModal card={card} columns={[{ id: "col1", name: "To Do" }]} members={[]} onClose={vi.fn()} onRefresh={vi.fn()} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function saveButton() {
  return screen.getByRole("button", { name: new RegExp(`${en.cardModal.saveChanges}|${en.cardModal.saved}`) });
}

describe("card modal mutation feedback", () => {
  beforeEach(() => {
    vi.mocked(updateCard).mockReset();
    vi.mocked(deleteComment).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("shows a rejected save's error inside the modal", async () => {
    vi.mocked(updateCard).mockResolvedValue({ success: false, error: "title: Card title is required" });
    renderModal();

    fireEvent.change(screen.getByDisplayValue("Original Title"), { target: { value: "" } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Card title is required");
  });

  it("shows a saved state after a successful save, then reverts", async () => {
    vi.mocked(updateCard).mockResolvedValue({ success: true, data: {} } as never);
    renderModal();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveButton()).toHaveTextContent(en.cardModal.saved);
    expect(saveButton().querySelector("[role=status]")).toBeNull();
    expect(screen.getByText(en.cardModal.saved, { selector: "[role=status]" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(saveButton()).toHaveTextContent(en.cardModal.saveChanges);
  });

  it("shows a failed comment delete inside the modal", async () => {
    vi.mocked(deleteComment).mockResolvedValue({ success: false, error: "Unauthorized" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderModal();

    fireEvent.click(screen.getByTitle(en.cardModal.deleteCommentTooltip));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
    expect(screen.getByText("First comment")).toBeInTheDocument();
  });
});
