import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import KanbanBoard from "../KanbanBoard";
import ListView from "../views/ListView";
import CalendarView from "../views/CalendarView";
import { filterCards, findCardByParam } from "@/lib/cardFilter";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

const mockCards = [
  {
    id: "card-1",
    title: "Implement auth",
    description: "OAuth and session support",
    number: 42,
    priority: "HIGH",
    order: 0,
    projectId: "p1",
    columnId: "col-1",
    labels: [],
    assignees: [],
    comments: [],
    activities: [],
    links: [],
    attachments: [],
    outgoingRelations: [],
    incomingRelations: [],
  },
  {
    id: "card-2",
    title: "Refactor database",
    description: "Migrate schema",
    number: 101,
    priority: "MEDIUM",
    order: 1,
    projectId: "p1",
    columnId: "col-1",
    labels: [],
    assignees: [],
    comments: [],
    activities: [],
    links: [],
    attachments: [],
    outgoingRelations: [],
    incomingRelations: [],
  },
];

const mockProject = {
  id: "p1",
  name: "My Project",
  key: "OPM",
  color: "#6366f1",
  visibility: "PRIVATE",
  isArchived: false,
  members: [],
  cardTypes: [],
  savedViews: [],
  columns: [
    {
      id: "col-1",
      name: "To Do",
      group: "UNSTARTED",
      isDone: false,
      color: "#6366f1",
      order: 0,
      cards: mockCards,
    },
  ],
};

describe("Card search by identifier and bare number (#270)", () => {
  it("filterCards finds card by KEY-NNN identifier", () => {
    const results = filterCards(mockCards, {
      searchQuery: "OPM-42",
      projectKey: "OPM",
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("card-1");
  });

  it("filterCards finds card by lowercase key and bare number", () => {
    const byLower = filterCards(mockCards, {
      searchQuery: "opm-42",
      projectKey: "OPM",
    });
    expect(byLower).toHaveLength(1);
    expect(byLower[0].id).toBe("card-1");

    const byBareNumber = filterCards(mockCards, {
      searchQuery: "42",
      projectKey: "OPM",
    });
    expect(byBareNumber).toHaveLength(1);
    expect(byBareNumber[0].id).toBe("card-1");

    const byHashNumber = filterCards(mockCards, {
      searchQuery: "#101",
      projectKey: "OPM",
    });
    expect(byHashNumber).toHaveLength(1);
    expect(byHashNumber[0].id).toBe("card-2");
  });

  it("findCardByParam resolves by identifier or bare number or ID", () => {
    expect(findCardByParam(mockCards, "OPM-42", "OPM")?.id).toBe("card-1");
    expect(findCardByParam(mockCards, "opm-101", "OPM")?.id).toBe("card-2");
    expect(findCardByParam(mockCards, "42", "OPM")?.id).toBe("card-1");
    expect(findCardByParam(mockCards, "#101", "OPM")?.id).toBe("card-2");
    expect(findCardByParam(mockCards, "card-1", "OPM")?.id).toBe("card-1");
  });

  it("ListView and CalendarView filter cards using identifier", () => {
    renderWithProviders(
      <ListView
        project={mockProject}
        onCardClick={vi.fn()}
        onRefresh={vi.fn()}
        searchQuery="OPM-42"
        priorityFilter="ALL"
      />
    );
    expect(screen.getByText("Implement auth")).toBeInTheDocument();
    expect(screen.queryByText("Refactor database")).not.toBeInTheDocument();
  });
});

describe("Deep linking and Copy link in modal (#270)", () => {
  it("opens the detail modal on load when initialCardParam is provided", () => {
    renderWithProviders(<KanbanBoard project={mockProject} initialCardParam="OPM-42" />);

    // Detail modal header should display the card identifier and title
    expect(screen.getByText("OPM-42")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Implement auth")).toBeInTheDocument();

    // Copy link button should be present in modal
    const copyLinkBtn = screen.getByRole("button", { name: /copy card link/i });
    expect(copyLinkBtn).toBeInTheDocument();
  });
});
