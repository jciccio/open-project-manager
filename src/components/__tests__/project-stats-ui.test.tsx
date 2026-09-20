import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProjectCard from "../ProjectCard";
import DashboardClient from "../DashboardClient";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import type { ProjectStats } from "@/lib/services/projectStats";

vi.mock("@/actions/projects", () => ({
  deleteProject: vi.fn(async () => ({ success: true })),
  archiveProject: vi.fn(async () => ({ success: true })),
  unarchiveProject: vi.fn(async () => ({ success: true })),
  updateProject: vi.fn(async () => ({ success: true })),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

function buildProject(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Project ${id}`,
    description: null,
    color: "#6366f1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { cards: 99, columns: 3 },
    ...overrides,
  };
}

const stats = (overrides: Partial<ProjectStats> = {}): ProjectStats => ({
  total: 4,
  done: 1,
  open: 3,
  overdue: 2,
  archived: 0,
  percentComplete: 25,
  ...overrides,
});

describe("ProjectCard stats", () => {
  it("shows percent complete, open/done counts, a progress bar and the overdue badge", () => {
    renderWithProviders(<ProjectCard project={buildProject("p1")} stats={stats()} />);

    expect(screen.getByText("25% complete")).toBeInTheDocument();
    expect(screen.getByText("3 open · 1 done")).toBeInTheDocument();
    expect(screen.getByText("2 overdue")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "25% complete" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("uses the stats total instead of the raw card count that includes archived cards", () => {
    renderWithProviders(<ProjectCard project={buildProject("p1")} stats={stats()} />);

    expect(screen.getByText("4 Cards")).toBeInTheDocument();
    expect(screen.queryByText("99 Cards")).not.toBeInTheDocument();
  });

  it("hides the overdue badge when nothing is overdue", () => {
    renderWithProviders(<ProjectCard project={buildProject("p1")} stats={stats({ overdue: 0 })} />);

    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("shows an empty state instead of NaN% for a project with no cards", () => {
    renderWithProviders(
      <ProjectCard
        project={buildProject("p1")}
        stats={stats({ total: 0, done: 0, open: 0, overdue: 0, percentComplete: null })}
      />
    );

    expect(screen.getByText("No cards yet")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("renders no stats block when stats are not provided (archived list)", () => {
    renderWithProviders(<ProjectCard project={buildProject("p1")} />);

    expect(screen.queryByTestId("project-stats")).not.toBeInTheDocument();
    expect(screen.getByText("99 Cards")).toBeInTheDocument();
  });
});

describe("DashboardClient workspace totals", () => {
  it("sums open, done and overdue across projects", () => {
    renderWithProviders(
      <DashboardClient
        user={{ name: "Tester", userId: "u1" }}
        projects={[buildProject("p1"), buildProject("p2")]}
        stats={{
          p1: stats({ open: 3, done: 1, overdue: 2, total: 4 }),
          p2: stats({ open: 5, done: 5, overdue: 1, total: 10 }),
        }}
        archivedCount={0}
      />
    );

    expect(within(screen.getByTestId("workspace-open")).getByText("8")).toBeInTheDocument();
    expect(within(screen.getByTestId("workspace-done")).getByText("6")).toBeInTheDocument();
    expect(within(screen.getByTestId("workspace-overdue")).getByText("3")).toBeInTheDocument();
  });
});
