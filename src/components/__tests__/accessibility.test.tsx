import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NewProjectModal from "../NewProjectModal";
import CardDetailModal from "../CardDetailModal";
import UserProfileModal from "../UserProfileModal";
import TaskCard from "../TaskCard";
import { LoginForm } from "@/app/login/LoginForm";
import { RegisterForm } from "@/app/register/RegisterForm";
import { LanguageProvider } from "../LanguageProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/actions/projects", () => ({
  createProject: vi.fn(async () => ({ success: true, data: { id: "p1" } })),
  getProjectById: vi.fn(async () => ({ success: true, data: { columns: [] } })),
}));

vi.mock("@/actions/cards", () => ({
  createCard: vi.fn(async () => ({ success: true })),
  updateCard: vi.fn(async () => ({ success: true })),
  deleteCard: vi.fn(async () => ({ success: true })),
  archiveCard: vi.fn(async () => ({ success: true })),
  getCardByIdentifier: vi.fn(async () => ({ success: false })),
  addCardLink: vi.fn(async () => ({ success: true })),
  removeCardLink: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/comments", () => ({
  addComment: vi.fn(async () => ({ success: true })),
  updateComment: vi.fn(async () => ({ success: true })),
  deleteComment: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/activity", () => ({
  getCardActivity: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/attachments", () => ({
  uploadAttachment: vi.fn(async () => ({ success: true })),
  listAttachments: vi.fn(async () => ({ success: true, data: [] })),
  deleteAttachment: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/labels", () => ({
  getLabels: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/cardTypes", () => ({
  getCardTypes: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/relations", () => ({
  addCardRelation: vi.fn(async () => ({ success: true })),
  removeCardRelation: vi.fn(async () => ({ success: true })),
  getCardRelations: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/members", () => ({
  getProjectMembers: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock("@/actions/auth", () => ({
  updateUserProfile: vi.fn(async () => ({ success: true })),
  listApiTokens: vi.fn(async () => ({ success: true, tokens: [] })),
  createApiToken: vi.fn(async () => ({ success: true, token: { secret: "opm_secret_token_123" } })),
  revokeApiToken: vi.fn(async () => ({ success: true })),
  getSsoStatus: vi.fn(async () => ({ success: true, data: { oidcEnabled: false, linked: false, hasPassword: true } })),
}));

vi.mock("@/actions/telemetry", () => ({
  getTelemetryStatus: vi.fn(async () => ({ success: true, data: null })),
  updateTelemetryPreference: vi.fn(async () => ({ success: true })),
}));

describe("Accessibility (Issue #113)", () => {
  const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentElement || document.body;
      },
    });
  });

  afterEach(() => {
    if (originalOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
    }
    vi.restoreAllMocks();
  });

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

      // Ignore Escape during IME composition (isComposing or keyCode 229)
      fireEvent.keyDown(window, { key: "Escape", isComposing: true });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape", keyCode: 229 });
      expect(onClose).not.toHaveBeenCalled();

      // Press Escape normally
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("restores focus to the trigger element on unmount and traps Tab / Shift+Tab within modal", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open Modal";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const onClose = vi.fn();
      const { unmount } = render(
        <LanguageProvider>
          <NewProjectModal onClose={onClose} />
        </LanguageProvider>
      );

      const dialog = screen.getByRole("dialog");
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      expect(focusable.length).toBeGreaterThan(1);

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Shift+Tab from first wraps to last
      first.focus();
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);

      // Tab from last wraps to first
      last.focus();
      fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(first);

      unmount();
      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });

    it("does not re-focus the first element when parent re-renders", () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <LanguageProvider>
          <NewProjectModal onClose={onClose} />
        </LanguageProvider>
      );

      const descInput = screen.getByLabelText(/Description/i);
      descInput.focus();
      expect(document.activeElement).toBe(descInput);

      // Re-render with new inline arrow for onClose
      rerender(
        <LanguageProvider>
          <NewProjectModal onClose={() => {}} />
        </LanguageProvider>
      );

      // Focus should remain on description input
      expect(document.activeElement).toBe(descInput);
    });

    it("closes only the topmost modal when Escape is pressed", () => {
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();

      render(
        <LanguageProvider>
          <div>
            <NewProjectModal onClose={onClose1} />
            <NewProjectModal onClose={onClose2} />
          </div>
        </LanguageProvider>
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose2).toHaveBeenCalledTimes(1);
      expect(onClose1).not.toHaveBeenCalled();
    });

    it("guards dirty CardDetailModal edits before closing on Escape", () => {
      const onClose = vi.fn();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      const mockCard: any = {
        id: "card-1",
        projectId: "proj-1",
        columnId: "col-1",
        title: "Original Title",
        description: "Original description",
        priority: "MEDIUM",
        points: null,
        owner: null,
        dueDate: null,
        labels: [],
        comments: [],
        activities: [],
      };

      render(
        <LanguageProvider>
          <CardDetailModal
            card={mockCard}
            columns={[{ id: "col-1", name: "To Do" }]}
            onClose={onClose}
            onRefresh={vi.fn()}
          />
        </LanguageProvider>
      );

      const titleInput = screen.getByDisplayValue("Original Title");
      fireEvent.change(titleInput, { target: { value: "Edited Unsaved Title" } });

      // Escape should prompt confirm; returning false keeps modal open
      fireEvent.keyDown(window, { key: "Escape" });
      expect(confirmSpy).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Confirming allows close
      confirmSpy.mockReturnValueOnce(true);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("guards UserProfileModal when profile is dirty or an API token was just generated", async () => {
      const onClose = vi.fn();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      render(
        <LanguageProvider>
          <UserProfileModal
            user={{ userId: "u1", email: "u1@example.com", name: "Alice" }}
            onClose={onClose}
          />
        </LanguageProvider>
      );

      // Edit name -> dirty guard triggers on Escape
      const nameInput = screen.getByDisplayValue("Alice");
      fireEvent.change(nameInput, { target: { value: "Alice Updated" } });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();

      // Revert name, generate an API token -> token guard triggers on Escape
      fireEvent.change(nameInput, { target: { value: "Alice" } });
      const tokenNameInput = screen.getByPlaceholderText(/Token name/i);
      fireEvent.change(tokenNameInput, { target: { value: "My Token" } });
      const generateBtn = screen.getByRole("button", { name: /Generate API Token/i });
      fireEvent.click(generateBtn);

      await waitFor(() => {
        expect(screen.getByDisplayValue("opm_secret_token_123")).toBeDefined();
      });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(onClose).not.toHaveBeenCalled();
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

    it("does not trigger row onClick when Enter or Space is pressed on a descendant element", () => {
      const onClick = vi.fn();
      const mockCard: any = {
        id: "c-descendant",
        title: "Task with Link",
        description: "Check [this link](https://example.com) for details",
        identifier: "PROJ-2",
        order: 0,
        columnId: "col-1",
        projectId: "p-1",
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { container } = render(
        <LanguageProvider>
          <TaskCard card={mockCard} onClick={onClick} />
        </LanguageProvider>
      );

      const link = container.querySelector("a");
      if (link) {
        fireEvent.keyDown(link, { key: "Enter" });
        expect(onClick).not.toHaveBeenCalled();

        fireEvent.keyDown(link, { key: " " });
        expect(onClick).not.toHaveBeenCalled();

        // Clicking the link itself should not trigger card onClick
        fireEvent.click(link);
        expect(onClick).not.toHaveBeenCalled();
      }
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
