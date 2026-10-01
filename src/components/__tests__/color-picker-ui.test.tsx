import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ColorPicker from "../ColorPicker";
import NewProjectModal from "../NewProjectModal";
import EditProjectModal from "../EditProjectModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { PROJECT_COLORS } from "@/lib/colors";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/actions/projects", () => ({
  createProject: vi.fn().mockResolvedValue({ success: true, data: { id: "p-new" } }),
  updateProject: vi.fn().mockResolvedValue({ success: true, data: { id: "p-edit" } }),
}));

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("ColorPicker & Project Modal UI Components", () => {
  it("renders all curated color swatches", () => {
    const handleChange = vi.fn();
    renderWithProviders(
      <ColorPicker value="#6366f1" onChange={handleChange} label="Color Theme" />
    );

    expect(screen.getByText("Color Theme")).toBeInTheDocument();
    expect(screen.getByText("#6366f1")).toBeInTheDocument();

    // Check all preset color swatches are rendered with labels
    for (const c of PROJECT_COLORS) {
      expect(screen.getByRole("button", { name: c.name })).toBeInTheDocument();
    }

    // Click on a different color swatch
    const emeraldBtn = screen.getByRole("button", { name: "Emerald" });
    fireEvent.click(emeraldBtn);
    expect(handleChange).toHaveBeenCalledWith("#10b981");
  });

  it("renders NewProjectModal with expanded color palette", () => {
    const handleClose = vi.fn();
    renderWithProviders(<NewProjectModal onClose={handleClose} />);

    expect(screen.getByText("Create New Project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Indigo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emerald" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ruby" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom Color" })).toBeInTheDocument();
  });

  it("renders EditProjectModal with project values and allows color change", async () => {
    const handleClose = vi.fn();
    const handleUpdate = vi.fn();
    const mockProject = {
      id: "p1",
      name: "Existing Project",
      description: "Existing Description",
      color: "#ec4899",
    };

    renderWithProviders(
      <EditProjectModal
        project={mockProject}
        onClose={handleClose}
        onUpdateSuccess={handleUpdate}
      />
    );

    expect(screen.getByText("Edit Project")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Existing Project")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Existing Description")).toBeInTheDocument();

    // Selecting another color
    const tealBtn = screen.getByRole("button", { name: "Teal" });
    fireEvent.click(tealBtn);

    const submitBtn = screen.getByRole("button", { name: "Save Changes" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(handleUpdate).toHaveBeenCalledWith({ id: "p-edit" });
  });

  it("sends null when the description is cleared, so the old text is removed", async () => {
    const { updateProject } = await import("@/actions/projects");
    renderWithProviders(
      <EditProjectModal
        project={{ id: "p1", name: "Existing Project", description: "Old text", color: "#ec4899" }}
        onClose={vi.fn()}
        onUpdateSuccess={vi.fn()}
      />
    );

    fireEvent.change(screen.getByDisplayValue("Old text"), { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });

    expect(updateProject).toHaveBeenLastCalledWith("p1", expect.objectContaining({ description: null }));
  });

  it("marks the selected color with aria-pressed and labels the swatch group", () => {
    renderWithProviders(<ColorPicker value="#10b981" onChange={vi.fn()} label="Color Theme" />);

    expect(screen.getByRole("group", { name: "Color Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emerald" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Indigo" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Custom Color" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Custom Color", { selector: "input" })).toHaveAttribute("type", "color");
  });

  it("treats a value from a custom palette as selected, not as a custom color", () => {
    const palette = [
      { name: "Brand", value: "#123456" },
      { name: "Accent", value: "#abcdef" },
    ];
    renderWithProviders(<ColorPicker value="#123456" onChange={vi.fn()} colors={palette} />);

    expect(screen.getByRole("button", { name: "Brand" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Custom Color" })).toHaveAttribute("aria-pressed", "false");
  });

  it("names the swatches in Spanish when the locale is Spanish", async () => {
    localStorage.setItem("opm_locale", "es");
    try {
      renderWithProviders(<ColorPicker value="#6366f1" onChange={vi.fn()} />);
      expect(await screen.findByRole("button", { name: "Esmeralda" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Azul marino" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Emerald" })).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("opm_locale");
    }
  });
});
