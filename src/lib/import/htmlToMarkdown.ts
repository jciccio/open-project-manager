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
interface ListItemElement {
  getAttribute(name: string): string | null;
  firstElementChild: (ListItemElement & { nodeName: string; querySelector(selector: string): ListItemElement | null }) | null;
  hasAttribute(name: string): boolean;
}

// Vikunja's TipTap editor writes checklist items as
// <li data-checked="true"><label><input type="checkbox"></label><div>…</div></li>.
// The GFM plugin only recognises a checkbox directly inside the <li>, so these
// would lose their state. Returns null for an ordinary list item.
function taskItemState(item: ListItemElement): boolean | null {
  const dataChecked = item.getAttribute("data-checked");
  if (dataChecked === "true" || dataChecked === "false") return dataChecked === "true";
  const label = item.firstElementChild;
  const box = label?.nodeName === "LABEL" ? label.querySelector('input[type="checkbox"]') : null;
  return box ? box.hasAttribute("checked") : null;
}

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
    const checked = taskItemState(node as unknown as ListItemElement);
    if (checked !== null) prefix += checked ? "[x] " : "[ ] ";
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
