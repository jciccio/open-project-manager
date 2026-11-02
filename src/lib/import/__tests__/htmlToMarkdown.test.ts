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

  it("keeps the checked state of Vikunja (TipTap) checklist items", () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-checked="true" data-task-id="ab12cd34"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Ship it</p></div></li>' +
      '<li data-checked="false" data-task-id="ef56gh78"><label><input type="checkbox"><span></span></label><div><p>Write docs</p></div></li>' +
      "</ul>";
    expect(htmlToMarkdown(html)).toBe("- [x] Ship it\n- [ ] Write docs");
  });

  it("reads the checkbox inside the label when data-checked is missing, and leaves plain items alone", () => {
    expect(htmlToMarkdown('<ul><li><label><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>')).toBe("- [x] Done");
    expect(htmlToMarkdown("<ul><li>Plain item</li></ul>")).toBe("- Plain item");
  });

  it("decodes hex, decimal and named HTML entities", () => {
    expect(htmlToMarkdown("<p>caf&#xE9; &#233; &eacute; &amp; &#x1F600;</p>")).toBe("café é é & 😀");
  });
});
