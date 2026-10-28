import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MarkdownRenderer } from "../MarkdownRenderer";

describe("MarkdownRenderer Component", () => {
  it("renders basic markdown elements correctly", () => {
    const markdown = "Hello **bold** and *italic* with `inline code`";
    render(<MarkdownRenderer content={markdown} />);

    expect(screen.getByText(/Hello/i)).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("inline code")).toBeInTheDocument();
  });

  it("renders safe external links with security attributes", () => {
    const markdown = "Visit [Google](https://google.com)";
    render(<MarkdownRenderer content={markdown} />);

    const link = screen.getByRole("link", { name: "Google" });
    expect(link).toHaveAttribute("href", "https://google.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("disallows dangerous javascript: URLs", () => {
    const markdown = "Bad [Exploit](javascript:alert(1))";
    render(<MarkdownRenderer content={markdown} />);

    const link = screen.getByText("Exploit");
    expect(link).not.toHaveAttribute("href");
  });

  it("returns null for empty content", () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeNull();
  });
});
