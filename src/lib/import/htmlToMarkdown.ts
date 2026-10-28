import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});

// Enable GFM plugin (tables, strikethrough, task lists)
turndownService.use(gfm);

// Rule for <br> so line breaks match CommonMark single newlines in cards
turndownService.addRule("lineBreak", {
  filter: "br",
  replacement: () => "\n",
});

// Rule for list items to produce compact list markers without 4-space tabs
turndownService.addRule("cleanListItem", {
  filter: "li",
  replacement: function (content, node, options) {
    content = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "")
      .replace(/\n/gm, "\n    ");
    let prefix = options.bulletListMarker + " ";
    const parent = (node as unknown as { parentNode?: { nodeName?: string; getAttribute?: (attr: string) => string | null; children?: unknown[] } }).parentNode;
    if (parent && parent.nodeName === "OL") {
      const start = parent.getAttribute ? parent.getAttribute("start") : null;
      const index = parent.children ? Array.prototype.indexOf.call(parent.children, node) : 0;
      prefix = (start ? Number(start) + index : index + 1) + ". ";
    }
    return prefix + content + (node.nextSibling && !/\n$/.test(content) ? "\n" : "");
  },
});

/**
 * Shared HTML-to-Markdown converter used across importers (Vikunja, Plane, etc.).
 * Converts HTML into CommonMark / GFM markdown using Turndown + GFM plugin,
 * ensuring no raw HTML tags leak into card descriptions or comment feeds.
 */
export function htmlToMarkdown(html: string | undefined | null): string {
  if (!html) return "";

  try {
    return turndownService.turndown(html).trim();
  } catch {
    // Safe fallback: strip HTML tags
    return html.replace(/<[^>]+>/g, "").trim();
  }
}
