import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import axe from "axe-core";
import KanbanBoard from "../KanbanBoard";
import { LoginForm } from "@/app/login/LoginForm";
import { RegisterForm } from "@/app/register/RegisterForm";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { en } from "@/locales/en";

vi.mock("../CardDetailModal", () => ({ default: () => null }));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

async function landmarkViolations() {
  const results = await axe.run(document, { runOnly: { type: "rule", values: ["landmark-one-main"] } });
  return results.violations.flatMap((violation) => violation.nodes);
}

const project = {
  id: "p1",
  name: "Landmarks",
  key: "LM",
  color: "#6366f1",
  isArchived: false,
  savedViews: [],
  cardTypes: [],
  labels: [],
  members: [],
  columns: [
    {
      id: "todo",
      projectId: "p1",
      name: "To Do",
      order: 0,
      group: "UNSTARTED",
      isDone: false,
      cards: [
        {
          id: "c1",
          number: 1,
          title: "A task",
          description: null,
          priority: "MEDIUM",
          points: null,
          owner: null,
          dueDate: new Date().toISOString(),
          labels: [],
          comments: [],
        },
      ],
    },
  ],
};

describe("main landmark", () => {
  it("is present once on the login page", async () => {
    renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={false} />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(await landmarkViolations()).toEqual([]);
  });

  it("is present once on the register page", async () => {
    renderWithProviders(<RegisterForm />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(await landmarkViolations()).toEqual([]);
  });

  it.each([
    ["kanban", "A task"],
    ["list", "A task"],
    ["calendar", "A task"],
    ["analytics", null],
  ] as const)("wraps the board's %s view", async (tab, visibleText) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderWithProviders(<KanbanBoard project={project as any} />);

    const [tabButton] = screen.getAllByRole("button", { name: en.views[tab] });
    fireEvent.click(tabButton);
    expect(tabButton.className).toContain("bg-indigo-600");

    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "Landmarks" }));
    if (visibleText) expect(main).toContainElement(screen.getAllByText(visibleText)[0]);
    expect(await landmarkViolations()).toEqual([]);
  });
});
