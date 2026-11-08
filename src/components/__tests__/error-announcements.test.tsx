import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ErrorBanner from "../ErrorBanner";
import NewProjectModal from "../NewProjectModal";
import EditProjectModal from "../EditProjectModal";
import { LoginForm } from "@/app/login/LoginForm";
import { RegisterForm } from "@/app/register/RegisterForm";
import { LanguageProvider } from "../LanguageProvider";
import { en } from "@/locales/en";

const { loginUser, registerUser, createProject, updateProject } = vi.hoisted(() => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("@/actions/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/actions/auth")>()),
  loginUser,
  registerUser,
}));
vi.mock("@/actions/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/actions/projects")>()),
  createProject,
  updateProject,
}));

function renderInLanguage(ui: React.ReactNode) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

function fill(element: Element, value: string) {
  fireEvent.change(element, { target: { value } });
}

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form")!);
}

describe("announcing errors to screen readers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.cookie = "opm_locale=en; path=/";
    window.history.pushState({}, "", "/");
  });

  it("gives ErrorBanner a live region and passes its id through", () => {
    render(<ErrorBanner id="the-error" message="It broke" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("It broke");
    expect(alert).toHaveAttribute("id", "the-error");
  });

  it("announces a wrong password on login and describes the inputs with it", async () => {
    loginUser.mockResolvedValue({ success: false, error: "Invalid email or password." });
    const { container } = renderInLanguage(<LoginForm oidcEnabled={false} registrationOpen={false} />);
    const email = container.querySelector('input[type="email"]')!;
    const password = container.querySelector('input[type="password"]')!;

    expect(email).not.toHaveAttribute("aria-describedby");

    fill(email, "a@example.com");
    fill(password, "wrong");
    submit(container);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password.");
    expect(email).toHaveAttribute("aria-describedby", alert.id);
    expect(password).toHaveAttribute("aria-describedby", alert.id);
  });

  it("announces a failed registration and describes every input with it", async () => {
    registerUser.mockResolvedValue({ success: false, error: "Email already registered" });
    const { container } = renderInLanguage(<RegisterForm />);
    const inputs = [...container.querySelectorAll("input")];

    inputs.forEach((input) => fill(input, input.type === "email" ? "a@example.com" : "Passw0rd!x"));
    submit(container);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email already registered");
    expect(inputs).toHaveLength(4);
    inputs.forEach((input) => expect(input).toHaveAttribute("aria-describedby", alert.id));
  });

  it("announces a failed create in the new project modal", async () => {
    createProject.mockResolvedValue({ success: false, error: "Nope" });
    const { container } = renderInLanguage(<NewProjectModal onClose={vi.fn()} />);

    fill(screen.getByPlaceholderText(en.newProjectModal.namePlaceholder), "A project");
    submit(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(en.newProjectModal.failedToCreate);
  });

  it("announces a failed update in the edit project modal", async () => {
    updateProject.mockResolvedValue({ success: false, error: "Nope" });
    const { container } = renderInLanguage(
      <EditProjectModal project={{ id: "p1", name: "Name", description: null, color: "#6366f1" }} onClose={vi.fn()} />
    );

    submit(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(en.editProjectModal.failedToUpdate);
  });
});
