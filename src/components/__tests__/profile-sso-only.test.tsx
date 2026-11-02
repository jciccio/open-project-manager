import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import UserProfileModal from "../UserProfileModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { getSsoStatus } from "@/actions/auth";

vi.mock("@/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/actions/auth")>();
  return {
    ...actual,
    getSsoStatus: vi.fn(),
    listApiTokens: vi.fn().mockResolvedValue({ success: true, tokens: [] }),
  };
});

function renderModal() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <UserProfileModal user={{ userId: "u1", email: "sso@example.com", name: "SSO User" }} onClose={vi.fn()} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function ssoStatus(overrides: Partial<Awaited<ReturnType<typeof getSsoStatus>>>) {
  vi.mocked(getSsoStatus).mockResolvedValue({
    success: true,
    oidcEnabled: true,
    linked: false,
    localPasswordAllowed: true,
    linkingDisablesPassword: true,
    ...overrides,
  } as Awaited<ReturnType<typeof getSsoStatus>>);
}

describe("UserProfileModal on an SSO-only account", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "opm_locale=en; path=/";
  });

  it("replaces the password fields with an explanation", async () => {
    ssoStatus({ linked: true, localPasswordAllowed: false });
    renderModal();

    expect(await screen.findByText("This account signs in through single sign-on, so it has no local password.")).toBeInTheDocument();
    expect(screen.queryByText("Current Password")).not.toBeInTheDocument();
    expect(screen.queryByText("New Password (optional)")).not.toBeInTheDocument();
  });

  it("warns before linking that password sign-in will stop", async () => {
    ssoStatus({ linked: false, localPasswordAllowed: true, linkingDisablesPassword: true });
    renderModal();

    expect(await screen.findByText("Connecting single sign-on turns off password sign-in for this account.")).toBeInTheDocument();
    expect(screen.getByText("Current Password")).toBeInTheDocument();
  });

  it("keeps the password fields and drops the warning when local passwords stay allowed", async () => {
    ssoStatus({ linked: false, localPasswordAllowed: true, linkingDisablesPassword: false });
    renderModal();

    expect(await screen.findByText("Connect single sign-on")).toBeInTheDocument();
    expect(screen.getByText("Current Password")).toBeInTheDocument();
    expect(screen.queryByText("Connecting single sign-on turns off password sign-in for this account.")).not.toBeInTheDocument();
  });
});
