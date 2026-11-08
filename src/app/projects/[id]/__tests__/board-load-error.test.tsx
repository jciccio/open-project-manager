import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProjectBoardPage from "../page";
import ProjectBoardError from "../error";
import { LanguageProvider } from "@/components/LanguageProvider";

const { getProjectById, getSession, notFound } = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/actions/projects", () => ({ getProjectById }));
vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("@/components/KanbanBoard", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound,
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const page = () => ProjectBoardPage({ params: Promise.resolve({ id: "p1" }) });

describe("project board page failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ userId: "u1", email: "a@example.com", name: "A" });
  });

  it("throws to the error boundary when the load fails internally", async () => {
    getProjectById.mockResolvedValue({ success: false, error: "Failed to fetch project details", kind: "internal" });

    await expect(page()).rejects.toThrow("Failed to fetch project details");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("shows not found for a missing or inaccessible project", async () => {
    getProjectById.mockResolvedValue({ success: false, error: "Project not found or access denied" });

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("offers a retry and a way back", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <ProjectBoardError error={new Error("hidden detail")} retry={retry} />
      </LanguageProvider>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This board couldn't be loaded");
    expect(screen.queryByText(/hidden detail/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
