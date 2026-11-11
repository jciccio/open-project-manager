import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MarkdownEditor from "../MarkdownEditor";
import DashboardClient from "../DashboardClient";
import Header from "../Header";
import { RegisterForm } from "@/app/register/RegisterForm";
import { LoginForm } from "@/app/login/LoginForm";
import { en } from "@/locales/en";
import { es } from "@/locales/es";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <LanguageProvider>{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

describe("Issue #131 Cleanup Verifications", () => {
  it("MarkdownEditor generates unique ids when omitted and isolates toolbar formatting to target instance", () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();

    const { container } = renderWithProviders(
      <div>
        <MarkdownEditor value="Editor 1" onChange={onChange1} />
        <MarkdownEditor value="Editor 2" onChange={onChange2} />
      </div>
    );

    const textareas = container.querySelectorAll("textarea");
    expect(textareas).toHaveLength(2);
    const id1 = textareas[0].getAttribute("id");
    const id2 = textareas[1].getAttribute("id");

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);

    // Find Bold button in the second editor's container
    const boldButtons = screen.getAllByTitle(/bold/i);
    expect(boldButtons).toHaveLength(2);

    fireEvent.click(boldButtons[1]);

    expect(onChange2).toHaveBeenCalledWith("**text**Editor 2");
    expect(onChange1).not.toHaveBeenCalled();
  });

  it("Header, LoginForm, and RegisterForm use Open Project Manager Logo alt text", () => {
    const { container: headerContainer } = renderWithProviders(
      <Header user={{ userId: "u1", email: "test@example.com", name: "User" }} />
    );
    const headerLogo = headerContainer.querySelector('img[alt="Open Project Manager Logo"]');
    expect(headerLogo).toBeInTheDocument();
    expect(headerContainer.querySelector('img[alt="Nanobanana Logo"]')).toBeNull();

    const { container: registerContainer } = renderWithProviders(<RegisterForm />);
    expect(registerContainer.querySelector('img[alt="Open Project Manager Logo"]')).toBeInTheDocument();
    expect(registerContainer.querySelector('img[alt="Nanobanana Logo"]')).toBeNull();

    const { container: loginContainer } = renderWithProviders(<LoginForm oidcEnabled={false} registrationOpen={false} />);
    expect(loginContainer.querySelector('img[alt="Open Project Manager Logo"]')).toBeInTheDocument();
    expect(loginContainer.querySelector('img[alt="Nanobanana Logo"]')).toBeNull();
  });

  it("Locales do not define duplicate confirmDeleteCard key", () => {
    expect(en.cardModal.deleteConfirm).toBeDefined();
    expect("confirmDeleteCard" in en.cardModal).toBe(false);

    expect(es.cardModal.deleteConfirm).toBeDefined();
    expect("confirmDeleteCard" in es.cardModal).toBe(false);
  });

  it("DashboardClient renders without requiring archivedCount prop", () => {
    const { container } = renderWithProviders(
      <DashboardClient
        user={{ userId: "u1", name: "Tester" }}
        projects={[]}
      />
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText(/Tester/i)).toBeInTheDocument();
  });
});
