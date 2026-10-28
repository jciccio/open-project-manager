import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Header from "../Header";
import { LoginForm } from "@/app/login/LoginForm";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

import UserProfileModal from "../UserProfileModal";
import { loginUser } from "@/actions/auth";

vi.mock("@/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/actions/auth")>();
  return {
    ...actual,
    loginUser: vi.fn(),
  };
});

// Helper wrapper for providers
function renderWithProviders(ui: React.ReactNode) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Authentication & Header UI Components", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "opm_locale=en; path=/";
    window.history.pushState({}, "", "/");
  });
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

  it("displays localized error message when login attempt fails", async () => {
    vi.mocked(loginUser).mockResolvedValueOnce({
      success: false,
      error: "Invalid email or password.",
    });

    renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={true} />);

    fireEvent.change(screen.getByPlaceholderText("admin@example.com"), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "badpassword" },
    });

    const submitBtn = screen.getByRole("button", { name: /sign in/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
  });

  it("renders SSO sign-in button when oidcEnabled is true", () => {
    renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);

    expect(screen.getByText("Sign in with SSO")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in with sso/i })).toHaveAttribute(
      "href",
      "/api/v1/auth/oidc/login"
    );
  });

  it("renders localized OIDC error messages from URL search params", () => {
    window.history.pushState({}, "", "/login?error=oidc_session_expired");
    const { unmount } = renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(screen.getByText("Your sign-in session expired. Please try again.")).toBeInTheDocument();
    unmount();

    window.history.pushState({}, "", "/login?error=oidc_link_required");
    const { unmount: u2 } = renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(
      screen.getByText(
        "An account with this email already exists. Sign in with your password, then connect single sign-on from Profile Settings."
      )
    ).toBeInTheDocument();
    u2();

    window.history.pushState({}, "", "/login?error=oidc_email_not_verified");
    const { unmount: u3 } = renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(
      screen.getByText(
        "Your identity provider did not confirm your email is verified, so it can't be linked to an existing account."
      )
    ).toBeInTheDocument();
    u3();

    window.history.pushState({}, "", "/login?error=oidc_missing_email");
    const { unmount: u4 } = renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(screen.getByText("Your identity provider did not provide an email address.")).toBeInTheDocument();
    u4();

    window.history.pushState({}, "", "/login?error=oidc_linked_elsewhere");
    renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(screen.getByText("This account is already connected to a different single sign-on identity.")).toBeInTheDocument();
  });

  it("dismisses query parameter error when submitting credentials", async () => {
    window.history.pushState({}, "", "/login?error=oidc_session_expired");
    renderWithProviders(<LoginForm oidcEnabled={true} registrationOpen={true} />);
    expect(screen.getByText("Your sign-in session expired. Please try again.")).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /sign in/i });
    fireEvent.submit(submitBtn.closest("form")!);

    expect(screen.queryByText("Your sign-in session expired. Please try again.")).toBeNull();
    expect(screen.getByText("Please fill in all fields.")).toBeInTheDocument();
  });

  it("renders LoginPage within Suspense boundary", async () => {
    const LoginPage = (await import("@/app/login/page")).default;
    const page = await LoginPage();
    renderWithProviders(page);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});

