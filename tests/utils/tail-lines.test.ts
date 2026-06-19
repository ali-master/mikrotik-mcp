import { describe, expect, test } from "bun:test";
import { tailLines } from "../../src/utils/tail-lines";

describe("tailLines", () => {
  test("returns the last n lines when text has more than n", () => {
    const text = "l1\nl2\nl3\nl4\nl5";
    expect(tailLines(text, 2)).toBe("l4\nl5");
    expect(tailLines(text, 3)).toBe("l3\nl4\nl5");
  });

  test("returns the text unchanged when it has fewer than n lines", () => {
    const text = "l1\nl2";
    expect(tailLines(text, 5)).toBe(text);
  });

  test("returns the text unchanged when it has exactly n lines", () => {
    const text = "l1\nl2\nl3";
    expect(tailLines(text, 3)).toBe(text);
  });

  test("treats n <= 0 or falsy as 'no cap'", () => {
    const text = "l1\nl2\nl3";
    expect(tailLines(text, 0)).toBe(text);
    expect(tailLines(text, -1)).toBe(text);
    expect(tailLines(text, Number.NaN)).toBe(text);
  });

  test("handles a single-line string", () => {
    expect(tailLines("only", 1)).toBe("only");
    expect(tailLines("only", 10)).toBe("only");
  });

  test("preserves blank trailing lines within the window", () => {
    const text = "a\nb\n\n";
    // split => ["a","b","",""]; last 2 => ["",""]
    expect(tailLines(text, 2)).toBe("\n");
  });
});
