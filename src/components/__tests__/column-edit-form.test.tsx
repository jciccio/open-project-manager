import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ColumnEditForm from "../ColumnEditForm";
import { LanguageProvider } from "../LanguageProvider";

const { updateColumn } = vi.hoisted(() => ({ updateColumn: vi.fn() }));
vi.mock("@/actions/columns", () => ({ updateColumn }));

type Column = Parameters<typeof ColumnEditForm>[0]["column"];

function renderForm(column: Column, onSaved = vi.fn(), onCancel = vi.fn()) {
  render(
    <LanguageProvider>
      <ColumnEditForm column={column} onSaved={onSaved} onCancel={onCancel} />
    </LanguageProvider>
  );
  return { onSaved, onCancel };
}

const groupSelect = () => screen.getByLabelText("State group") as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ColumnEditForm default state group", () => {
  it("uses the column's group when it is a known group", () => {
    renderForm({ id: "c1", name: "Review", group: "STARTED", isDone: false });
    expect(groupSelect().value).toBe("STARTED");
  });

  it("falls back to Completed for a legacy done column without a group", () => {
    renderForm({ id: "c1", name: "Shipped", group: null, isDone: true });
    expect(groupSelect().value).toBe("COMPLETED");
  });

  it("falls back to Unstarted for an unknown group on a column that isn't done", () => {
    renderForm({ id: "c1", name: "Ideas", group: "SOMEDAY", isDone: false });
    expect(groupSelect().value).toBe("UNSTARTED");
  });
});

describe("ColumnEditForm save", () => {
  it("sends the edited fields, a trimmed description and no color when 'No color' is ticked", async () => {
    updateColumn.mockResolvedValue({ success: true });
    const { onSaved } = renderForm({ id: "c1", name: "Review", group: "STARTED", color: "#ff0000", description: null });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Code review" } });
    fireEvent.change(groupSelect(), { target: { value: "COMPLETED" } });
    fireEvent.click(screen.getByLabelText("No color"));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Waiting on a reviewer  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateColumn).toHaveBeenCalledWith("c1", {
        name: "Code review",
        group: "COMPLETED",
        color: null,
        description: "Waiting on a reviewer",
      })
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("sends a null description when it is left blank and keeps the existing color", async () => {
    updateColumn.mockResolvedValue({ success: true });
    renderForm({ id: "c1", name: "Review", group: "STARTED", color: "#ff0000", description: "Old" });

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateColumn).toHaveBeenCalledWith("c1", expect.objectContaining({ color: "#ff0000", description: null }))
    );
  });

  it("shows the server's error and stays open when the save fails", async () => {
    updateColumn.mockResolvedValue({ success: false, error: "Column name is required" });
    const { onSaved } = renderForm({ id: "c1", name: "Review", group: "STARTED" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Column name is required")).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a fallback error when the save throws", async () => {
    updateColumn.mockRejectedValue(new Error("network"));
    const { onSaved } = renderForm({ id: "c1", name: "Review", group: "STARTED" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to update column.")).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("calls onCancel without saving", () => {
    const { onCancel } = renderForm({ id: "c1", name: "Review", group: "STARTED" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(updateColumn).not.toHaveBeenCalled();
  });
});
