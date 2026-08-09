import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProjectCard from "../ProjectCard";
import TaskCard from "../TaskCard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Kanban & Project UI Components", () => {
  it("renders ProjectCard with name, description, and stats", () => {
    const mockProject = {
      id: "p1",
      name: "E-Commerce System",
      description: "Building new checkout funnel",
      color: "#6366f1",
      createdAt: new Date("2026-01-01"),
      _count: {
        cards: 12,
        columns: 4,
      },
    };

    renderWithProviders(<ProjectCard project={mockProject} />);

    expect(screen.getByText("E-Commerce System")).toBeInTheDocument();
    expect(screen.getByText("Building new checkout funnel")).toBeInTheDocument();
    expect(screen.getByText(/4\s+Columns/i)).toBeInTheDocument();
    expect(screen.getByText(/12\s+Cards/i)).toBeInTheDocument();
  });

  it("renders TaskCard with priority, points, owner, and labels", () => {
    const mockCard = {
      id: "c1",
      title: "Implement Stripe Webhooks",
      description: "Handle checkout.session.completed",
      priority: "HIGH",
      points: 8,
      owner: "Alice",
      dueDate: "2026-09-01",
      labels: [
        { label: { id: "l1", name: "Backend", color: "#3b82f6" } },
      ],
      comments: [{ id: "cm1", content: "Working on it" }],
    };

    const handleClick = vi.fn();

    renderWithProviders(<TaskCard card={mockCard} onClick={handleClick} />);

    expect(screen.getByText("Implement Stripe Webhooks")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("8 pts")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument(); // Alice avatar initial

    fireEvent.click(screen.getByText("Implement Stripe Webhooks"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
