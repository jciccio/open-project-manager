import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProjectBoardPage from "../page";

const { getProjectById, getCardByProjectAndParam, getSession, kanbanPropsSpy } = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getCardByProjectAndParam: vi.fn(),
  getSession: vi.fn(),
  kanbanPropsSpy: vi.fn(),
}));

vi.mock("@/actions/projects", () => ({ getProjectById }));
vi.mock("@/actions/cards", () => ({ getCardByProjectAndParam }));
vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("@/components/KanbanBoard", () => ({
  default: (props: Record<string, unknown>) => {
    kanbanPropsSpy(props);
    return null;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
}));

const activeCard = { id: "card-1", number: 1, title: "Active card" };
const archivedCard = { id: "card-99", number: 99, title: "Archived card", isArchived: true };

const projectData = {
  id: "p1",
  name: "Demo",
  key: "OPM",
  columns: [{ id: "col-1", name: "To Do", cards: [activeCard] }],
};

describe("project board page deep-link fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ userId: "u1", email: "a@example.com", name: "A" });
    getProjectById.mockResolvedValue({ success: true, data: projectData });
  });

  it("falls back to getCardByProjectAndParam when the card is not on the active board", async () => {
    getCardByProjectAndParam.mockResolvedValue({ success: true, data: archivedCard });

    const tree = await ProjectBoardPage({
      params: Promise.resolve({ id: "p1" }),
      searchParams: Promise.resolve({ card: "OPM-99" }),
    });
    render(tree);

    expect(getCardByProjectAndParam).toHaveBeenCalledWith("p1", "OPM-99");
    expect(kanbanPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCardParam: "OPM-99",
        initialCard: archivedCard,
      })
    );
  });

  it("uses the active board card directly without calling getCardByProjectAndParam", async () => {
    const tree = await ProjectBoardPage({
      params: Promise.resolve({ id: "p1" }),
      searchParams: Promise.resolve({ card: "OPM-1" }),
    });
    render(tree);

    expect(getCardByProjectAndParam).not.toHaveBeenCalled();
    expect(kanbanPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCardParam: "OPM-1",
        initialCard: activeCard,
      })
    );
  });
});
