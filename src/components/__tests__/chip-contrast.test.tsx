import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TaskCard from "../TaskCard";
import ListView from "../views/ListView";
import CardTypeManagerModal from "../CardTypeManagerModal";
import LabelManagerModal from "../LabelManagerModal";
import CardDetailModal from "../CardDetailModal";
import ArchivedClient from "@/app/archived/ArchivedClient";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

vi.mock("@/actions/cardTypes", () => ({
  getCardTypes: vi.fn(async () => ({
    success: true,
    data: [{ id: "t1", name: "Feature", color: "#10b981", icon: "sparkles" }],
  })),
  createCardType: vi.fn(),
  updateCardType: vi.fn(),
  deleteCardType: vi.fn(),
}));

vi.mock("@/actions/labels", () => ({
  getLabels: vi.fn(async () => ({
    success: true,
    data: [
      { id: "l1", name: "Selected Label", color: "#10b981" },
      { id: "l2", name: "Unselected Label", color: "#ef4444" },
    ],
  })),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Chip text contrast on component surfaces (#285)", () => {
  it("TaskCard applies dark text for light label and card-type background colors", () => {
    const card = {
      id: "c1",
      title: "Test Contrast",
      priority: "NONE",
      projectId: "p1",
      labels: [
        { label: { id: "l1", name: "Emerald Label", color: "#10b981" } },
      ],
      type: { id: "t1", name: "Pink Type", color: "#ec4899", icon: "sparkles" },
    };

    renderWithProviders(<TaskCard card={card as any} onClick={vi.fn()} />);

    const labelChip = screen.getByText("Emerald Label");
    expect(labelChip).toHaveClass("text-black");
    expect(labelChip).not.toHaveClass("text-white");

    const typeBadge = screen.getByText("Pink Type");
    expect(typeBadge.parentElement).toHaveClass("text-black");
    expect(typeBadge.parentElement).not.toHaveClass("text-white");
  });

  it("ListView applies dark text for light label chips", () => {
    const project = {
      id: "p1",
      name: "List Project",
      columns: [
        {
          id: "col-1",
          name: "To Do",
          cards: [
            {
              id: "c1",
              title: "List Card",
              priority: "NONE",
              labels: [
                { label: { id: "l1", name: "Light Label", color: "#3b82f6" } },
              ],
            },
          ],
        },
      ],
    };

    renderWithProviders(
      <ListView
        project={project}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        searchQuery=""
        priorityFilter="ALL"
      />
    );

    const labelChip = screen.getByText("Light Label");
    expect(labelChip).toHaveClass("text-black");
    expect(labelChip).not.toHaveClass("text-white");
  });

  it("CardTypeManagerModal applies dark text to light card-type preview chips", async () => {
    renderWithProviders(
      <CardTypeManagerModal projectId="p1" onClose={vi.fn()} />
    );

    const typeChip = await screen.findByText("Feature");
    expect(typeChip.closest("span")).toHaveClass("text-black");
    expect(typeChip.closest("span")).not.toHaveClass("text-white");
  });

  it("LabelManagerModal applies dark text to light label chips in list and edit modes", async () => {
    renderWithProviders(
      <LabelManagerModal onClose={vi.fn()} />
    );

    // Existing label list chip (light emerald #10b981)
    const listChip = await screen.findByText("Selected Label");
    expect(listChip).toHaveClass("text-black");
    expect(listChip).not.toHaveClass("text-white");

    // Enter edit mode on the first label and check the edit preview chip
    const editButtons = screen.getAllByRole("button", { name: /edit label/i });
    fireEvent.click(editButtons[0]);

    const editChip = await screen.findByText("Selected Label");
    expect(editChip).toHaveClass("text-black");
    expect(editChip).not.toHaveClass("text-white");
  });

  it("CardDetailModal avoids opacity-60 on unselected label toggles and uses high contrast text", async () => {
    const card = {
      id: "c1",
      title: "Detail Card",
      description: "",
      projectId: "p1",
      columnId: "col-1",
      priority: "NONE",
      points: null,
      owner: null,
      dueDate: null,
      labels: [
        { label: { id: "l1", name: "Selected Label", color: "#10b981" } },
      ],
      comments: [],
      activities: [],
      assignees: [],
      links: [],
      attachments: [],
      project: {
        id: "p1",
        labels: [
          { id: "l1", name: "Selected Label", color: "#10b981" },
          { id: "l2", name: "Unselected Label", color: "#ef4444" },
        ],
      },
    };

    renderWithProviders(
      <CardDetailModal
        card={card as any}
        columns={[{ id: "col-1", name: "To Do" }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const unselectedBtn = await screen.findByRole("button", { name: /^Unselected Label$/i });
    expect(unselectedBtn).not.toHaveClass("opacity-60");
    // Verify unselected toggle has dark/light mode high contrast text classes
    expect(unselectedBtn.className).toMatch(/text-slate-700/);

    const selectedBtn = await screen.findByRole("button", { name: /^Selected Label$/i });
    expect(selectedBtn).toHaveClass("text-black");
    expect(selectedBtn).not.toHaveClass("text-white");
  });

  it("ArchivedClient active tab uses text-slate-950 against amber-500", () => {
    renderWithProviders(
      <ArchivedClient
        archivedProjects={[]}
        archivedCards={[]}
        currentUserId="u1"
      />
    );

    const activeTab = screen.getByRole("button", { name: /Projects \(0\)/i });
    expect(activeTab).toHaveClass("text-slate-950");
    expect(activeTab).not.toHaveClass("text-white");
  });
});
