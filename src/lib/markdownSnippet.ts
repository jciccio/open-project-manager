const SOURCE_LIMIT = 1000;
const SNIPPET_LIMIT = 200;

export function markdownSnippet(markdown: string): string {
  const text = markdown
    .slice(0, SOURCE_LIMIT)
    .replace(/^\s*(?:```|~~~).*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, "")
    .replace(/\*\*|~~|`/g, "")
    .replace(/(?<!\w)__(?=\S)|(?<=\S)__(?!\w)/g, "")
    .replace(/(?<![\w*])[*_](?=\S)([^*_\n]*\S)[*_](?![\w*])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > SNIPPET_LIMIT ? `${text.slice(0, SNIPPET_LIMIT).trimEnd()}…` : text;
}
