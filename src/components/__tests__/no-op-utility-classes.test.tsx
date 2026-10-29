import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarkdownRenderer } from "../MarkdownRenderer";
import NewProjectModal from "../NewProjectModal";
import LabelManagerModal from "../LabelManagerModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Non-existent Tailwind utility classes (#130)", () => {
  it("does not include uninstalled typography plugin classes in MarkdownRenderer", () => {
    const { container } = render(<MarkdownRenderer content="Sample text" />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root?.className).not.toContain("prose");
    expect(root?.className).not.toContain("dark:prose-invert");
  });

  it("does not include uninstalled tailwindcss-animate classes on modal backdrops", () => {
    const { container: newProjectContainer } = renderWithProviders(
      <NewProjectModal onClose={vi.fn()} />
    );
    const modalBackdrop = newProjectContainer.firstElementChild;
    expect(modalBackdrop).not.toBeNull();
    expect(modalBackdrop?.className).not.toContain("animate-in");
    expect(modalBackdrop?.className).not.toContain("fade-in");

    const { container: labelModalContainer } = renderWithProviders(
      <LabelManagerModal onClose={vi.fn()} />
    );
    const labelBackdrop = labelModalContainer.firstElementChild;
    expect(labelBackdrop).not.toBeNull();
    expect(labelBackdrop?.className).not.toContain("animate-in");
    expect(labelBackdrop?.className).not.toContain("fade-in");
  });
});
