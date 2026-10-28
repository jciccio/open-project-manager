import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../htmlToMarkdown";

describe("htmlToMarkdown shared converter", () => {
  it("converts HTML tables to GFM Markdown tables", () => {
    const html = `
      <table>
        <thead>
          <tr><th>Feature</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>Comments</td><td>Done</td></tr>
        </tbody>
      </table>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("| Feature | Status |");
    expect(md).toContain("| Comments | Done |");
  });

  it("converts HTML strikethrough tags (<del>, <s>, <strike>) to GFM strikethrough", () => {
    expect(htmlToMarkdown("<del>obsolete</del>")).toContain("~obsolete~");
    expect(htmlToMarkdown("<s>struck</s>")).toContain("~struck~");
  });

  it("converts HTML lists and blockquotes cleanly", () => {
    expect(htmlToMarkdown("<blockquote>Important note</blockquote>")).toBe("> Important note");
    expect(htmlToMarkdown("<ul><li>item 1</li><li>item 2</li></ul>")).toBe("- item 1\n- item 2");
    expect(htmlToMarkdown("<ol><li>first</li><li>second</li></ol>")).toBe("1. first\n2. second");
  });

  it("handles null and undefined gracefully", () => {
    expect(htmlToMarkdown(null)).toBe("");
    expect(htmlToMarkdown(undefined)).toBe("");
  });
});
