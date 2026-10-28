const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Shared HTML-to-Markdown converter used across importers (Vikunja, Plane, etc.).
 * Converts HTML into CommonMark / GFM markdown, ensuring no raw HTML tags leak into
 * card descriptions or comment feeds.
 */
export function htmlToMarkdown(html: string | undefined | null): string {
  if (!html) return "";

  let out = html.replace(/\r\n/g, "\n");

  // Block-level code first, so its contents are not touched by inline rules.
  out = out.replace(
    /<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi,
    (_m, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`
  );
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, code) => `\`${code}\``);

  // Links and Emphasis
  out = out.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) => `[${text}](${href})`
  );
  out = out.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_m, text) => `**${text}**`);
  out = out.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_m, text) => `*${text}*`);
  out = out.replace(/<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_m, text) => `~~${text}~~`);

  // Headings
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => {
    const hashes = "#".repeat(Number(level));
    return `\n\n${hashes} ${String(text).trim()}\n\n`;
  });

  // Blockquotes
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, text) => {
    const lines = String(text)
      .trim()
      .split("\n")
      .map((l) => `> ${l.trim()}`)
      .join("\n");
    return `\n\n${lines}\n\n`;
  });

  // Lists (Ordered & Unordered)
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, body: string) => {
    let n = 0;
    return `\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_li, item) => `${++n}. ${String(item).trim()}\n`)}\n`;
  });
  out = out.replace(
    /<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_m, body: string) => `\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_li, item) => `- ${String(item).trim()}\n`)}\n`
  );
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => `- ${String(item).trim()}\n`);

  // Line breaks and paragraph dividers
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<\/(?:div|h[1-6]|blockquote)>/gi, "\n\n");

  // Strip remaining HTML tags
  out = out.replace(/<[^>]+>/g, "");

  // Entity decoding
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  out = out.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));

  return out.replace(/\n{3,}/g, "\n\n").trim();
}
