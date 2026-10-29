import { render, screen } from "@testing-library/react";
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
  it("MarkdownEditor allows unique id per instance and uses ref for textarea formatting", () => {
    const { container } = renderWithProviders(
      <MarkdownEditor id="custom-editor-1" value="Hello" onChange={vi.fn()} />
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeInTheDocument();
    expect(textarea?.getAttribute("id")).toBe("custom-editor-1");
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

    const { container: loginContainer } = renderWithProviders(<LoginForm />);
    expect(loginContainer.querySelector('img[alt="Open Project Manager Logo"]')).toBeInTheDocument();
    expect(loginContainer.querySelector('img[alt="Nanobanana Logo"]')).toBeNull();
  });

  it("Locales do not define duplicate confirmDeleteCard key", () => {
    expect((en as any).cardModal.deleteConfirm).toBeDefined();
    expect((en as any).cardModal.confirmDeleteCard).toBeUndefined();

    expect((es as any).cardModal.deleteConfirm).toBeDefined();
    expect((es as any).cardModal.confirmDeleteCard).toBeUndefined();
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
