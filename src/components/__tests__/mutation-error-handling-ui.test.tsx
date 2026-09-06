import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import KanbanColumn from "../KanbanColumn";
import LabelManagerModal from "../LabelManagerModal";
import ProjectCard from "../ProjectCard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { createCard } from "@/actions/cards";
import { getLabels, createLabel } from "@/actions/labels";
import { archiveProject } from "@/actions/projects";

vi.mock("@/actions/cards", () => ({
  createCard: vi.fn(),
}));

vi.mock("@/actions/labels", () => ({
  getLabels: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

vi.mock("@/actions/projects", () => ({
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
  deleteProject: vi.fn(),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Mutation error handling", () => {
  it("KanbanColumn: re-enables the submit button and shows an error when createCard rejects", async () => {
    vi.mocked(createCard).mockRejectedValueOnce(new Error("network drop"));

    renderWithProviders(
      <KanbanColumn
        column={{ id: "col1", projectId: "p1", name: "To Do", order: 0, cards: [] }}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        onDragStartCard={vi.fn()}
        onDropCard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle("Add Card"));
    fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: "New Task" } });

    const submitButtons = screen.getAllByText("Add Card").map((el) => el.closest("button")!);
    const submitButton = submitButtons.find((btn) => btn.type === "submit")!;
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.getByText("Failed to add card.")).toBeInTheDocument());
    expect(submitButton).not.toBeDisabled();
  });

  it("LabelManagerModal: shows an error when createLabel returns success: false", async () => {
    vi.mocked(getLabels).mockResolvedValue({ success: true, data: [] });
    vi.mocked(createLabel).mockResolvedValueOnce({ success: false, error: "Label already exists" });

    renderWithProviders(<LabelManagerModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/label name/i), { target: { value: "Bug" } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(screen.getByText("Label already exists")).toBeInTheDocument());
  });

  it("ProjectCard: does not call onDeleteSuccess when archiving fails", async () => {
    vi.mocked(archiveProject).mockResolvedValueOnce({ success: false, error: "Cannot archive right now" });
    const onDeleteSuccess = vi.fn();

    renderWithProviders(
      <ProjectCard
        project={{
          id: "p1",
          name: "Test Project",
          description: null,
          color: "#6366f1",
          isArchived: false,
          createdAt: new Date("2026-01-01"),
          _count: { cards: 0, columns: 0 },
        }}
        onDeleteSuccess={onDeleteSuccess}
      />
    );

    fireEvent.click(screen.getByTitle("Archive project"));

    await waitFor(() => expect(screen.getByText("Cannot archive right now")).toBeInTheDocument());
    expect(onDeleteSuccess).not.toHaveBeenCalled();
  });
});
