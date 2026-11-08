import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import KanbanBoard from "../KanbanBoard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("../CardDetailModal", () => ({ default: () => null }));

const project = {
  id: "p1",
  name: "Project",
  color: "#6366f1",
  isArchived: false,
  savedViews: [],
  cardTypes: [{ id: "t1", name: "Bug", icon: "bug", color: "#ef4444" }],
  columns: [{ id: "c1", projectId: "p1", name: "To Do", order: 0, group: "UNSTARTED", isDone: false, cards: [] }],
};

describe("keyboard focus indicators on the board", () => {
  it("gives every control that removes the outline a focus-visible ring", () => {
    const { container } = render(
      <ThemeProvider>
        <LanguageProvider>
          <KanbanBoard project={project} />
        </LanguageProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getAllByTitle("Add Card")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit column" }));

    const controls = [...container.querySelectorAll("input, select, textarea")];
    const withoutOutline = controls.filter((el) => el.className.includes("focus:outline-none"));

    expect(withoutOutline.length).toBeGreaterThanOrEqual(8);
    expect(withoutOutline.filter((el) => !el.className.includes("focus-visible:ring-2"))).toEqual([]);
  });
});
