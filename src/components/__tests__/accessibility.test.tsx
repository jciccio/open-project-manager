import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import NewProjectModal from "../NewProjectModal";
import TaskCard from "../TaskCard";
import { LoginForm } from "@/app/login/LoginForm";
import { RegisterForm } from "@/app/register/RegisterForm";
import { LanguageProvider } from "../LanguageProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/actions/projects", () => ({
  createProject: vi.fn(async () => ({ success: true, data: { id: "p1" } })),
}));

describe("Accessibility (Issue #113)", () => {
  describe("Modal Dialog Semantics and Keyboard Trapping", () => {
    it("renders modal with role='dialog', aria-modal='true', and responds to Escape key", () => {
      const onClose = vi.fn();
      render(
        <LanguageProvider>
          <NewProjectModal onClose={onClose} />
        </LanguageProvider>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeDefined();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).toBe("new-project-title");

      // Press Escape
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("TaskCard Keyboard Accessibility", () => {
    it("renders TaskCard as keyboard-accessible interactive element", () => {
      const onClick = vi.fn();
      const mockCard: any = {
        id: "c-1",
        title: "Test Task",
        identifier: "PROJ-1",
        order: 0,
        columnId: "col-1",
        projectId: "p-1",
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      render(
        <LanguageProvider>
          <TaskCard card={mockCard} onClick={onClick} />
        </LanguageProvider>
      );

      const cardElement = screen.getByRole("button", { name: /Test Task/i });
      expect(cardElement.getAttribute("tabindex")).toBe("0");

      // Test Enter key
      fireEvent.keyDown(cardElement, { key: "Enter" });
      expect(onClick).toHaveBeenCalledTimes(1);

      // Test Space key
      fireEvent.keyDown(cardElement, { key: " " });
      expect(onClick).toHaveBeenCalledTimes(2);
    });
  });

  describe("Form Input Accessibility Labels", () => {
    it("associates labels with inputs in LoginForm", () => {
      render(
        <LanguageProvider>
          <LoginForm oidcEnabled={false} registrationOpen={true} />
        </LanguageProvider>
      );

      const emailInput = screen.getByLabelText(/Email/i);
      expect(emailInput).toBeDefined();
      expect(emailInput.getAttribute("id")).toBe("login-email");

      const passwordInput = screen.getByLabelText(/Password/i);
      expect(passwordInput).toBeDefined();
      expect(passwordInput.getAttribute("id")).toBe("login-password");
    });

    it("associates labels with inputs in RegisterForm", () => {
      render(
        <LanguageProvider>
          <RegisterForm />
        </LanguageProvider>
      );

      const nameInput = screen.getByLabelText(/Full Name/i);
      expect(nameInput).toBeDefined();
      expect(nameInput.getAttribute("id")).toBe("register-name");

      const emailInput = screen.getByLabelText(/Email/i);
      expect(emailInput).toBeDefined();
      expect(emailInput.getAttribute("id")).toBe("register-email");

      const passwordInput = screen.getByLabelText(/^Password$/i);
      expect(passwordInput).toBeDefined();
      expect(passwordInput.getAttribute("id")).toBe("register-password");

      const confirmInput = screen.getByLabelText(/Confirm Password/i);
      expect(confirmInput).toBeDefined();
      expect(confirmInput.getAttribute("id")).toBe("register-confirm-password");
    });
  });
});
