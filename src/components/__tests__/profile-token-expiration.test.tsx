import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import UserProfileModal from "../UserProfileModal";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import { getSsoStatus, listApiTokens, createApiToken } from "@/actions/auth";

vi.mock("@/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/actions/auth")>();
  return {
    ...actual,
    getSsoStatus: vi.fn(),
    listApiTokens: vi.fn(),
    createApiToken: vi.fn(),
  };
});

function renderModal() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <UserProfileModal user={{ userId: "u1", email: "user@example.com", name: "User" }} onClose={vi.fn()} />
      </LanguageProvider>
    </ThemeProvider>
  );
}

describe("UserProfileModal API Token expiration", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "opm_locale=en; path=/";
    vi.mocked(getSsoStatus).mockResolvedValue({
      success: true,
      oidcEnabled: false,
      linked: false,
      localPasswordAllowed: true,
      linkingDisablesPassword: false,
    });
  });

  it("displays expiration options and passes selected expiration to createApiToken", async () => {
    vi.mocked(listApiTokens).mockResolvedValue({ success: true, tokens: [] });
    vi.mocked(createApiToken).mockResolvedValue({
      success: true,
      token: {
        id: "tok-1",
        name: "My Token",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        secret: "secret-jwt",
      },
    });

    renderModal();

    const input = await screen.findByPlaceholderText("Token name (e.g. Claude Desktop)");
    const select = screen.getByLabelText("Expiration") as HTMLSelectElement;

    expect(select).toBeInTheDocument();
    expect(select.value).toBe("365");

    fireEvent.change(select, { target: { value: "30" } });
    expect(select.value).toBe("30");

    fireEvent.change(input, { target: { value: "My Token" } });
    const generateBtn = screen.getByRole("button", { name: /generate/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(createApiToken).toHaveBeenCalledWith("My Token", 30);
    });
  });

  it("displays expiration status in active tokens list", async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    vi.mocked(listApiTokens).mockResolvedValue({
      success: true,
      tokens: [
        {
          id: "tok-expiring",
          name: "Expiring Soon",
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: futureDate,
        },
        {
          id: "tok-expired",
          name: "Old Token",
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: pastDate,
        },
        {
          id: "tok-never",
          name: "Permanent Token",
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: null,
        },
      ],
    });

    renderModal();

    expect(await screen.findByText("Expiring Soon")).toBeInTheDocument();
    expect(screen.getByText("Old Token")).toBeInTheDocument();
    expect(screen.getByText("Permanent Token")).toBeInTheDocument();

    const neverElements = screen.getAllByText(/Never expires/i);
    expect(neverElements.length).toBeGreaterThanOrEqual(2); // In select option and in token list
    expect(screen.getByText(/Expired/i)).toBeInTheDocument();
  });
});
