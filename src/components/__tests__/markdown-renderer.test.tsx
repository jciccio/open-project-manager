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

  it("renders GFM tables correctly", () => {
    const tableMarkdown = `
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
`;
    render(<MarkdownRenderer content={tableMarkdown} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Header 1")).toBeInTheDocument();
    expect(screen.getByText("Cell 1")).toBeInTheDocument();
  });

  it("renders GFM strikethrough", () => {
    const markdown = "This is ~~deleted text~~";
    const { container } = render(<MarkdownRenderer content={markdown} />);

    const delElement = container.querySelector("del");
    expect(delElement).toBeInTheDocument();
    expect(delElement?.textContent).toBe("deleted text");
  });

  it("renders GFM task list items with checkboxes", () => {
    const markdown = "- [x] Finished task\n- [ ] Pending task";
    render(<MarkdownRenderer content={markdown} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
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

  it("escapes raw HTML tags instead of executing them", () => {
    const markdown = '<script>alert("xss")</script><img src="x" onerror="alert(1)">';
    const { container } = render(<MarkdownRenderer content={markdown} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("returns null for empty content", () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeNull();
  });
});
