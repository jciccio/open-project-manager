import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const { mockUnarchiveCard } = vi.hoisted(() => ({
  mockUnarchiveCard: vi.fn(),
}));

vi.mock("@/actions/cards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/actions/cards")>();
  return {
    ...actual,
    unarchiveCard: (...args: Parameters<typeof actual.unarchiveCard>) => mockUnarchiveCard(...args),
  };
});

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

  it("does not match all cards when search query is a substring of key or dash", () => {
    const cards = [
      { id: "c1", title: "Task 1", number: 42, priority: "NONE" },
      { id: "c2", title: "Task 2", number: 420, priority: "NONE" },
    ];
    expect(filterCards(cards, { searchQuery: "opm", projectKey: "OPM" })).toHaveLength(0);
    expect(filterCards(cards, { searchQuery: "op", projectKey: "OPM" })).toHaveLength(0);
    expect(filterCards(cards, { searchQuery: "-", projectKey: "OPM" })).toHaveLength(0);
    expect(filterCards(cards, { searchQuery: "OPM-42", projectKey: "OPM" }).map((c) => c.id)).toEqual(["c1"]);
  });

  it("CalendarView filters cards using identifier and projectKey", () => {
    const today = new Date().toISOString();
    const calendarCards = [
      { ...mockCards[0], dueDate: today },
      { ...mockCards[1], dueDate: today },
    ];
    const projectWithDueDates = {
      ...mockProject,
      columns: [
        {
          ...mockProject.columns[0],
          cards: calendarCards,
        },
      ],
    };
    renderWithProviders(
      <CalendarView
        project={projectWithDueDates}
        onCardClick={vi.fn()}
        searchQuery="OPM-42"
        priorityFilter="ALL"
      />
    );
    expect(screen.getByText("Implement auth")).toBeInTheDocument();
    expect(screen.queryByText("Refactor database")).not.toBeInTheDocument();
  });

  it("KanbanBoard filters cards by identifier using project key in columns", () => {
    renderWithProviders(<KanbanBoard project={mockProject} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "OPM-42" } });

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

  it("copies direct card URL to clipboard when Copy link button is clicked", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderWithProviders(<KanbanBoard project={mockProject} initialCardParam="OPM-42" />);

    const copyLinkBtn = screen.getByRole("button", { name: /copy card link/i });
    fireEvent.click(copyLinkBtn);

    expect(writeTextMock).toHaveBeenCalledWith("http://localhost:3000/projects/p1?card=OPM-42");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /link copied/i })).toBeInTheDocument();
    });
  });

  it("opens archived card in modal when provided via initialCard", () => {
    const archivedCard = {
      id: "card-archived",
      title: "Archived ticket",
      description: "Old work",
      number: 99,
      isArchived: true,
      priority: "LOW",
      projectId: "p1",
      columnId: "col-1",
      project: { id: "p1", key: "OPM", name: "My Project" },
      labels: [],
      assignees: [],
      comments: [],
      activities: [],
      links: [],
      attachments: [],
      outgoingRelations: [],
      incomingRelations: [],
    };

    renderWithProviders(
      <KanbanBoard project={mockProject} initialCardParam="OPM-99" initialCard={archivedCard} />
    );

    expect(screen.getByDisplayValue("Archived ticket")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restore card/i })).toBeInTheDocument();
  });

  it("stays closed when restoring an archived card from a deep link and board re-renders", async () => {
    const previousUrl = window.location.pathname + window.location.search;
    window.history.replaceState({}, "", "/projects/p1?card=OPM-99");
    mockUnarchiveCard.mockResolvedValue({ success: true });

    try {
      const archivedCard = {
        id: "card-archived",
        title: "Archived ticket",
        description: "Old work",
        number: 99,
        isArchived: true,
        priority: "LOW",
        projectId: "p1",
        columnId: "col-1",
        project: { id: "p1", key: "OPM", name: "My Project" },
        labels: [],
        assignees: [],
        comments: [],
        activities: [],
        links: [],
        attachments: [],
        outgoingRelations: [],
        incomingRelations: [],
      };

      const { rerender } = renderWithProviders(
        <KanbanBoard project={mockProject} initialCardParam="OPM-99" initialCard={archivedCard} />
      );

      expect(screen.getByDisplayValue("Archived ticket")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /restore card/i }));

      await waitFor(() => {
        expect(mockUnarchiveCard).toHaveBeenCalledWith("card-archived");
        expect(screen.queryByDisplayValue("Archived ticket")).not.toBeInTheDocument();
      });

      expect(window.location.search).toBe("");

      // Simulate Next.js Server Action revalidation re-rendering with the restored card
      // now active in project.columns while stale initialCardParam is still present
      const restoredCard = { ...archivedCard, isArchived: false };
      const refreshedProject = {
        ...mockProject,
        columns: [
          {
            ...mockProject.columns[0],
            cards: [...mockProject.columns[0].cards, restoredCard],
          },
        ],
      };

      rerender(
        <ThemeProvider>
          <LanguageProvider>
            <KanbanBoard project={refreshedProject} initialCardParam="OPM-99" initialCard={restoredCard} />
          </LanguageProvider>
        </ThemeProvider>
      );

      expect(screen.queryByDisplayValue("Archived ticket")).not.toBeInTheDocument();
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });
});
