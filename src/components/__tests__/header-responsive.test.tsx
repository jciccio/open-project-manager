import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Header from "../Header";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

function renderHeader(user = { userId: "u123", email: "user@example.com", name: "Alice" }, archivedCount = 3) {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <Header user={user} archivedCount={archivedCount} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

describe("Header Responsive Layout", () => {
  it("renders responsive header with hidden text labels on small viewports", () => {
    const { container } = renderHeader();

    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
    // Verify compact mobile padding classes
    expect(header?.className).toContain("px-3");
    expect(header?.className).toContain("sm:px-6");

    // New Project button should have hidden text on small screens
    const newProjectBtn = screen.getByRole("button", { name: /new project/i });
    expect(newProjectBtn).toBeInTheDocument();
    const newProjectSpan = newProjectBtn.querySelector("span");
    expect(newProjectSpan?.className).toContain("hidden");
    expect(newProjectSpan?.className).toContain("sm:inline");

    // Archived and Labels buttons should also have hidden text on small screens
    const archivedLink = screen.getByRole("link", { name: /archived/i });
    expect(archivedLink.querySelector("span")?.className).toContain("hidden");
    expect(archivedLink.querySelector("span")?.className).toContain("sm:inline");

    // Archived badge uses valid Tailwind padding
    const archivedBadge = screen.getByText("3");
    expect(archivedBadge.className).toContain("py-0.5");
    expect(archivedBadge.className).not.toContain("py-0.2");
  });
});
