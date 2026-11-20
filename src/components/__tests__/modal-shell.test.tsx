import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { Modal, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, ModalDismissButton } from "../Modal";
import KanbanBoard from "../KanbanBoard";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

const { createSavedView } = vi.hoisted(() => ({
  createSavedView: vi.fn(async () => ({ success: true, data: { id: "v1", name: "Mine", filterJson: "{}", isDefault: false } })),
}));

vi.mock("@/actions/views", () => ({ createSavedView, deleteSavedView: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}, onSubmit = vi.fn((e) => e.preventDefault())) {
  render(
    <Modal labelledBy="t" {...props}>
      <ModalHeader>
        <h3 id="t">Title</h3>
        <ModalCloseButton onClick={() => {}} label="Close" />
      </ModalHeader>
      <ModalBody>
        <form id="f" onSubmit={onSubmit}>
          <input aria-label="name" />
        </form>
      </ModalBody>
      <ModalFooter>
        <ModalDismissButton onClick={() => {}}>Cancel</ModalDismissButton>
        <button type="submit" form="f">
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
  return onSubmit;
}

describe("Modal shell", () => {
  it("labels the dialog and keeps the footer outside the scrolling body", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("t");
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("overflow-hidden");

    const body = screen.getByLabelText("name").closest(".overflow-y-auto");
    const save = screen.getByRole("button", { name: "Save" });
    expect(body).not.toBeNull();
    expect(body!.contains(save)).toBe(false);
    expect(save.parentElement!.className).toContain("shrink-0");
  });

  it("submits the body form from the footer button", () => {
    const onSubmit = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click and Escape only when the site opts in", () => {
    const onBackdropClick = vi.fn();
    const onEscape = vi.fn();
    const { unmount } = render(
      <Modal labelledBy="t" onBackdropClick={onBackdropClick} onEscape={onEscape}>
        <ModalBody>inner</ModalBody>
      </Modal>
    );
    const backdrop = screen.getByRole("dialog").parentElement!;

    fireEvent.mouseDown(screen.getByText("inner"));
    fireEvent.click(screen.getByText("inner"));
    expect(onBackdropClick).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onBackdropClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not throw on backdrop click or Escape when the site doesn't opt in", () => {
    renderModal();
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});

describe("Save view dialog", () => {
  it("saves the view from the pinned footer button", async () => {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <KanbanBoard
            project={{ id: "p1", name: "Board", key: "B", columns: [], members: [], cardTypes: [], savedViews: [] }}
          />
        </LanguageProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTitle("Save Current View"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/view name/i), { target: { value: "Mine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createSavedView).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Mine" })));
  });
});

describe("one overlay definition", () => {
  const componentsDir = path.resolve(__dirname, "..");
  const overlayClass = ["fixed", "inset-0"].join(" ");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("defines the full-screen overlay only in Modal.tsx", () => {
    const withOverlay = sourceFiles(componentsDir)
      .filter((file) => readFileSync(file, "utf8").includes(overlayClass))
      .map((file) => path.relative(componentsDir, file));
    expect(withOverlay).toEqual(["Modal.tsx"]);
  });
});
