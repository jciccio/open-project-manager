import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PageError from "../PageError";
import { LanguageProvider } from "../LanguageProvider";

describe("PageError", () => {
  it("announces the error, retries, and links back to projects", () => {
    const retry = vi.fn();
    render(
      <LanguageProvider>
        <PageError title="This board couldn't be loaded" message="Your project is unchanged." retry={retry} />
      </LanguageProvider>
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This board couldn't be loaded");
    expect(alert.textContent).toContain("Your project is unchanged.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("link", { name: "Back to projects" }).getAttribute("href")).toBe("/");
  });
});
