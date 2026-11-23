import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const urlStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    delivered: "",
    deferred: false,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    deliver() {
      store.delivered = window.location.search;
      listeners.forEach((notify) => notify());
    },
  };
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args);
    if (!store.deferred) store.deliver();
  };
  return store;
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(urlStore.subscribe, () => urlStore.delivered)),
  };
});

const ME = "user-me";

function buildProject(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: ME,
    name,
    key: id.toUpperCase(),
    description: null,
    color: "#6366f1",
    visibility: "PRIVATE",
    members: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { cards: 0, columns: 3 },
    ...overrides,
  };
}

const stats = (open: number): ProjectStats => ({
  total: open,
  done: 0,
  open,
  overdue: 0,
  archived: 0,
  percentComplete: open ? 0 : null,
});

const projects = [
  buildProject("web", "Website", { createdAt: new Date("2026-03-01T00:00:00Z") }),
  buildProject("ops", "Operations", {
    userId: "someone-else",
    members: [{ userId: ME, role: "MEMBER" }],
    createdAt: new Date("2026-02-01T00:00:00Z"),
  }),
  buildProject("api", "API Platform", { visibility: "INTERNAL", createdAt: new Date("2026-01-01T00:00:00Z") }),
];
const projectStats = { web: stats(1), ops: stats(7), api: stats(3) };

function renderDashboard(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <DashboardClient
          user={{ userId: ME, name: "Me" }}
          projects={projects}
          stats={projectStats}
        />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function projectNames() {
  return screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
}

afterEach(() => {
  urlStore.deferred = false;
  window.history.replaceState(null, "", "/");
});

describe("dashboard project filters and sorting", () => {
  it("lists projects newest first with the total count by default", () => {
    renderDashboard();
    expect(projectNames()).toEqual(["Website", "Operations", "API Platform"]);
    expect(screen.getByTestId("project-count")).toHaveTextContent("3");
  });

  it("filters by search, shows N of M, and writes the query to the URL", () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText("Search projects", { selector: "input" }), {
      target: { value: "web" },
    });

    expect(projectNames()).toEqual(["Website"]);
    expect(screen.getByTestId("project-count")).toHaveTextContent("1 of 3");
    expect(window.location.search).toBe("?q=web");
  });

  it("filters by role and visibility", () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "shared" } });
    expect(projectNames()).toEqual(["Operations"]);

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "INTERNAL" } });
    expect(projectNames()).toEqual(["API Platform"]);
  });

  it("re-sorts by a stats-based order without changing the count", () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "mostOpen" } });

    expect(projectNames()).toEqual(["Operations", "API Platform", "Website"]);
    expect(screen.getByTestId("project-count")).toHaveTextContent("3");
    expect(window.location.search).toBe("?sort=mostOpen");
  });

  it("starts from the query in the URL", () => {
    renderDashboard("?sort=nameAsc");
    expect(screen.getByLabelText("Sort by")).toHaveValue("nameAsc");
    expect(projectNames()).toEqual(["API Platform", "Operations", "Website"]);
  });

  it("shows a no-match state whose clear action restores the list but keeps the sort", () => {
    renderDashboard("?q=nothing&sort=nameDesc");

    const empty = screen.getByRole("heading", { name: "No projects match" }).parentElement!;
    expect(screen.queryByText("No active projects")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-count")).toHaveTextContent("0 of 3");

    fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" }));
    expect(projectNames()).toEqual(["Website", "Operations", "API Platform"]);
    expect(screen.getByLabelText("Sort by")).toHaveValue("nameDesc");
    expect(window.location.search).toBe("?sort=nameDesc");
  });

  it("keeps every keystroke when the URL catches up a render late", () => {
    renderDashboard();
    urlStore.deferred = true;
    const input = screen.getByLabelText("Search projects", { selector: "input" });
    fireEvent.change(input, { target: { value: "o" } });
    fireEvent.change(input, { target: { value: "op" } });
    expect(input).toHaveValue("op");

    act(() => urlStore.deliver());
    expect(input).toHaveValue("op");
    expect(projectNames()).toEqual(["Operations"]);
  });

  it("resets to an outside URL even when it matches the one it started from", () => {
    renderDashboard();
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "shared" } });
    expect(projectNames()).toEqual(["Operations"]);

    act(() => window.history.replaceState(null, "", "/"));
    expect(screen.getByLabelText("Role")).toHaveValue("all");
    expect(projectNames()).toEqual(["Website", "Operations", "API Platform"]);
  });

  it("follows the URL when it changes from outside the toolbar", () => {
    renderDashboard("?role=shared");
    expect(projectNames()).toEqual(["Operations"]);

    act(() => window.history.replaceState(null, "", "/"));
    expect(screen.getByLabelText("Role")).toHaveValue("all");
    expect(projectNames()).toEqual(["Website", "Operations", "API Platform"]);
  });

  it("keeps the no-projects state and hides the toolbar when there are no projects", () => {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <DashboardClient user={{ userId: ME }} projects={[]} stats={{}} />
        </LanguageProvider>
      </ThemeProvider>
    );
    expect(screen.getByText("No active projects")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
  });
});
