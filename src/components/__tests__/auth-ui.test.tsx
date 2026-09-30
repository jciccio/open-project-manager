import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Header from "../Header";
import { LoginForm } from "@/app/login/LoginForm";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

import UserProfileModal from "../UserProfileModal";

// Helper wrapper for providers
function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Authentication & Header UI Components", () => {
  it("renders Header with app title and user profile when user is logged in", () => {
    renderWithProviders(
      <Header
        user={{
          userId: "u123",
          email: "john@example.com",
          name: "John Doe",
        }}
        archivedCount={2}
      />
    );

    expect(screen.getByText("Open Project Manager")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.queryByText("john@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("opens UserProfileModal when clicking profile button in Header", () => {
    renderWithProviders(
      <Header
        user={{
          userId: "u123",
          email: "john@example.com",
          name: "John Doe",
        }}
      />
    );

    const profileBtn = screen.getByTitle("Profile Settings");
    fireEvent.click(profileBtn);

    expect(screen.getByDisplayValue("John Doe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("john@example.com")).toBeInTheDocument();
    expect(screen.getByText("Developer API Token")).toBeInTheDocument();
    expect(screen.getByText("Generate API Token")).toBeInTheDocument();
  });

  it("renders UserProfileModal with API token section", () => {
    renderWithProviders(
      <UserProfileModal
        user={{
          userId: "u123",
          email: "sarah@example.com",
          name: "Sarah Conner",
        }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Developer API Token")).toBeInTheDocument();
    expect(screen.getByText("Generate API Token")).toBeInTheDocument();
  });

  it("toggles locale when language button is clicked", () => {
    renderWithProviders(<Header user={null} />);

    const langBtn = screen.getByTitle("Switch Language (EN / ES)");
    expect(langBtn).toBeInTheDocument();

    // Default locale is EN
    expect(screen.getByText("en")).toBeInTheDocument();

    fireEvent.click(langBtn);

    // Switches to ES
    expect(screen.getByText("es")).toBeInTheDocument();
  });

  it("renders the login form with email, password inputs, and submit button", () => {
    renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={true} />);

    expect(screen.getByPlaceholderText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    const submitButtons = screen.getAllByRole("button");
    expect(submitButtons.length).toBeGreaterThan(0);
  });

  it("links to /register only while registration is open", () => {
    const { unmount } = renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={true} />);
    expect(document.querySelector('a[href="/register"]')).not.toBeNull();
    unmount();

    renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={false} />);
    expect(document.querySelector('a[href="/register"]')).toBeNull();
  });
});

