import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProjectMembersModal from "../ProjectMembersModal";
import { LanguageProvider } from "../LanguageProvider";

const { getProjectMembers, addProjectMember, updateMemberRole, removeProjectMember, updateProject, refresh } =
  vi.hoisted(() => ({
    getProjectMembers: vi.fn(),
    addProjectMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeProjectMember: vi.fn(),
    updateProject: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("@/actions/members", () => ({ getProjectMembers, addProjectMember, updateMemberRole, removeProjectMember }));
vi.mock("@/actions/projects", () => ({ updateProject }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const creator = { id: "m1", userId: "u-owner", role: "OWNER", user: { name: "Olivia Owner", email: "olivia@example.com" } };
const coOwner = { id: "m2", userId: "u-co", role: "OWNER", user: { name: "Carl Co", email: "carl@example.com" } };
const member = { id: "m3", userId: "u-member", role: "MEMBER", user: { name: "Mia Member", email: "mia@example.com" } };

function project(currentUserRole?: string | null) {
  return { id: "p1", name: "Apollo", userId: "u-owner", visibility: "PRIVATE", currentUserRole };
}

function row(email: string) {
  return screen.getByText(email).closest(".justify-between") as HTMLElement;
}

async function renderModal(currentUserRole: string | null | undefined, responseRole?: string, onMembersChange = vi.fn()) {
  getProjectMembers.mockResolvedValue({
    success: true,
    data: [creator, coOwner, member],
    currentUserRole: responseRole ?? currentUserRole,
  });
  render(<ProjectMembersModal project={project(currentUserRole)} onClose={vi.fn()} onMembersChange={onMembersChange} />, { wrapper: LanguageProvider });
  await screen.findByText("mia@example.com");
  return onMembersChange;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectMembersModal as owner", () => {
  it("keeps the creator's row read-only and lets the owner manage everyone else", async () => {
    await renderModal("OWNER");

    expect(within(row("olivia@example.com")).queryByRole("combobox")).toBeNull();
    expect(within(row("olivia@example.com")).queryByTitle("Remove member")).toBeNull();
    expect(within(row("olivia@example.com")).getByText("OWNER")).toBeDefined();

    expect(within(row("carl@example.com")).getByRole("combobox")).toBeDefined();
    expect(within(row("mia@example.com")).getByTitle("Remove member")).toBeDefined();
  });

  it("switches visibility through updateProject", async () => {
    updateProject.mockResolvedValue({ success: true });
    await renderModal("OWNER");

    fireEvent.click(screen.getByRole("button", { name: /Internal/ }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("p1", { visibility: "INTERNAL" }));
    expect(await screen.findByText("Project visibility set to internal")).toBeDefined();
    expect(refresh).toHaveBeenCalled();
  });

  it("invites a collaborator with the chosen role, then reloads the list", async () => {
    addProjectMember.mockResolvedValue({
      success: true,
      data: { role: "VIEWER", user: { name: "Vic Viewer", email: "vic@example.com" } },
    });
    const onMembersChange = await renderModal("OWNER");
    expect(getProjectMembers).toHaveBeenCalledTimes(1);

    const form = screen.getByPlaceholderText("collaborator@example.com").closest("form") as HTMLElement;
    fireEvent.change(within(form).getByPlaceholderText("collaborator@example.com"), {
      target: { value: "vic@example.com" },
    });
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "VIEWER" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addProjectMember).toHaveBeenCalledWith("p1", "vic@example.com", "VIEWER"));
    expect(await screen.findByText("Added Vic Viewer as VIEWER")).toBeDefined();
    expect(getProjectMembers).toHaveBeenCalledTimes(2);
    expect(onMembersChange).toHaveBeenCalledTimes(1);
  });

  it("changes a member's role and removes a member", async () => {
    updateMemberRole.mockResolvedValue({ success: true });
    removeProjectMember.mockResolvedValue({ success: true });
    await renderModal("OWNER");

    fireEvent.change(within(row("mia@example.com")).getByRole("combobox"), { target: { value: "ADMIN" } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith("p1", "u-member", "ADMIN"));
    expect(await screen.findByText("Member role updated")).toBeDefined();

    fireEvent.click(within(row("mia@example.com")).getByTitle("Remove member"));
    await waitFor(() => expect(removeProjectMember).toHaveBeenCalledWith("p1", "u-member"));
    expect(await screen.findByText("Member removed from project")).toBeDefined();
  });

  it("shows the server's error when an invite fails", async () => {
    addProjectMember.mockResolvedValue({ success: false, error: "User not found" });
    await renderModal("OWNER");

    fireEvent.change(screen.getByPlaceholderText("collaborator@example.com"), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("User not found")).toBeDefined();
    expect(getProjectMembers).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectMembersModal as admin", () => {
  it("disables visibility and offers no OWNER role", async () => {
    await renderModal("ADMIN");

    expect((screen.getByRole("button", { name: /Internal/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Private/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("* Only project owners can modify visibility settings.")).toBeDefined();

    const form = screen.getByPlaceholderText("collaborator@example.com").closest("form") as HTMLElement;
    const inviteRoles = within(form).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(inviteRoles).not.toContain("OWNER");

    const memberRoles = within(row("mia@example.com")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(memberRoles).not.toContain("OWNER");
  });

  it("can't manage another owner but can manage a member", async () => {
    await renderModal("ADMIN");

    expect(within(row("carl@example.com")).queryByRole("combobox")).toBeNull();
    expect(within(row("carl@example.com")).queryByTitle("Remove member")).toBeNull();
    expect(within(row("mia@example.com")).getByRole("combobox")).toBeDefined();
  });

  it("takes the role from the members response when the prop has none", async () => {
    await renderModal(undefined, "ADMIN");

    expect(screen.getByPlaceholderText("collaborator@example.com")).toBeDefined();
    expect(within(row("mia@example.com")).getByRole("combobox")).toBeDefined();
  });
});

describe("ProjectMembersModal as viewer", () => {
  it("shows no invite form and no member controls", async () => {
    await renderModal("VIEWER");

    expect(screen.queryByPlaceholderText("collaborator@example.com")).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByTitle("Remove member")).toHaveLength(0);
    expect(within(row("mia@example.com")).getByText("MEMBER")).toBeDefined();
  });
});

describe("ProjectMembersModal load failure", () => {
  it("shows the load error", async () => {
    getProjectMembers.mockResolvedValue({ success: false, error: "Project not found" });
    render(<ProjectMembersModal project={project("OWNER")} onClose={vi.fn()} />, { wrapper: LanguageProvider });

    expect(await screen.findByText("Project not found")).toBeDefined();
    expect(screen.getByText("Project Members (0)")).toBeDefined();
  });
});
