import { describe, expect, it } from "vitest";
import { markdownSnippet } from "../markdownSnippet";

describe("markdownSnippet", () => {
  it.each([
    ["# Heading\nBody", "Heading Body"],
    ["**bold** and *italic* and __strong__ and _em_", "bold and italic and strong and em"],
    ["Use `npm test` now", "Use npm test now"],
    ["See [the docs](https://example.com/a) here", "See the docs here"],
    ["![diagram](https://example.com/a.png) below", "diagram below"],
    ["> quoted\n- first\n* second\n1. third\n- [x] done", "quoted first second third done"],
    ["```ts\nconst a = 1;\n```", "const a = 1;"],
    ["| a | b |\n|---|---|\n| 1 | 2 |", "| a | b | | 1 | 2 |"],
    ["~~gone~~ stays", "gone stays"],
  ])("strips markup from %j", (input, expected) => {
    expect(markdownSnippet(input)).toBe(expected);
  });

  it("keeps underscores and asterisks that aren't emphasis", () => {
    expect(markdownSnippet("set snake_case_name to 2 * 3 * 4")).toBe("set snake_case_name to 2 * 3 * 4");
  });

  it("collapses whitespace and returns an empty string for markup-only input", () => {
    expect(markdownSnippet("one\n\n   two\tthree")).toBe("one two three");
    expect(markdownSnippet("---\n\n```\n```")).toBe("");
  });

  it("caps long text with an ellipsis", () => {
    const snippet = markdownSnippet("word ".repeat(100));
    expect(snippet.length).toBeLessThanOrEqual(201);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
