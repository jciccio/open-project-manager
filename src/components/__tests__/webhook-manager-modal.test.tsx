import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import WebhookManagerModal from "../WebhookManagerModal";
import * as webhookActions from "@/actions/webhooks";

vi.mock("@/actions/webhooks", () => ({
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));

describe("WebhookManagerModal", () => {
  const mockProject = {
    id: "proj-1",
    name: "Engineering",
    userId: "user-1",
    currentUserRole: "OWNER",
  };
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders existing webhooks and allows toggling status", async () => {
    vi.mocked(webhookActions.listWebhooks).mockResolvedValue({
      success: true,
      data: [
        {
          id: "hook-1",
          projectId: "proj-1",
          url: "https://ci.example.com/build",
          eventsJson: JSON.stringify(["card_created", "moved"]),
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    vi.mocked(webhookActions.updateWebhook).mockResolvedValue({
      success: true,
      data: {
        id: "hook-1",
        projectId: "proj-1",
        url: "https://ci.example.com/build",
        eventsJson: JSON.stringify(["card_created", "moved"]),
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    render(<WebhookManagerModal project={mockProject} onClose={mockOnClose} />);

    expect(screen.getByText("Project Webhooks")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("https://ci.example.com/build")).toBeInTheDocument();
    });

    expect(screen.getAllByText("card_created").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("moved").length).toBeGreaterThanOrEqual(2);

    const pauseButton = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(webhookActions.updateWebhook).toHaveBeenCalledWith("hook-1", { isActive: false });
    });
  });

  it("creates a new webhook and displays the generated secret", async () => {
    vi.mocked(webhookActions.listWebhooks).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(webhookActions.createWebhook).mockResolvedValue({
      success: true,
      data: {
        id: "hook-new",
        projectId: "proj-1",
        url: "https://api.example.com/events",
        secret: "supersecrettoken1234567890abcdef",
        eventsJson: JSON.stringify(["card_created"]),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    render(<WebhookManagerModal project={mockProject} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("https://example.com/api/webhook")).toBeInTheDocument();
    });

    const urlInput = screen.getByPlaceholderText("https://example.com/api/webhook");
    fireEvent.change(urlInput, { target: { value: "https://api.example.com/events" } });

    const submitBtn = screen.getByRole("button", { name: /Create Webhook/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(webhookActions.createWebhook).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({
          url: "https://api.example.com/events",
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("supersecrettoken1234567890abcdef")).toBeInTheDocument();
      expect(screen.getByText("Webhook created successfully!")).toBeInTheDocument();
    });
  });
});
