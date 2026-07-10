/**
 * The What's-New modal's markdown renderer.
 *
 * The regression that prompted these: every block regex was anchored at `^` with
 * no leading-space allowance, while the real GitHub release body arrives with a
 * two-space indent on every line but the first. Headings, lists, tables,
 * blockquotes and rules all fell through to the paragraph path, so users saw a
 * literal `### ✨ Features`. CommonMark allows up to three spaces before a block
 * marker; the renderer now does too.
 */
import { describe, expect, test } from "vite-plus/test";
import { renderMarkdown } from "../ui/observability/markdown";

/** The v4.3.0 release body, verbatim from the GitHub API (CRLF, 2-space indent). */
const REAL_BODY = [
  "## v4.3.0",
  "",
  "  First tagged release with formal notes. Tracks **RouterOS 7.23.2** (2026-Jul-03).",
  "",
  "  ### ✨  Features",
  "",
  "  - **OSPF: `ptmp-broadcast` link type** — `add_ospf_interface_template` now accepts `type=ptmp-broadcast`.",
  "",
  "  ### 🧹 Maintenance",
  "",
  "  - Regenerated `schemas/` and `docs/tools-reference.md` for the new OSPF enum.",
  "  - Normalized `required` / `enum` array formatting across generated schemas.",
].join("\r\n");

describe("renderMarkdown", () => {
  describe("the indented-release-body regression", () => {
    const html = renderMarkdown(REAL_BODY);

    test("renders no literal markdown markers", () => {
      expect(html).not.toContain("###");
      expect(html).not.toMatch(/<p>\s*-\s/); // a list item that fell through to <p>
    });

    test("indented headings become headings", () => {
      expect(html).toContain("<h4>✨  Features</h4>");
      expect(html).toContain("<h4>🧹 Maintenance</h4>");
      expect(html).toContain("<h3>v4.3.0</h3>"); // the one unindented line
    });

    test("indented list items become a list", () => {
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>");
      expect(html).toContain("Normalized <code>required</code>");
    });

    test("inline markup inside indented blocks still renders", () => {
      expect(html).toContain("<strong>RouterOS 7.23.2</strong>");
      expect(html).toContain("<code>ptmp-broadcast</code>");
    });
  });

  describe("leading-space tolerance", () => {
    // CommonMark: up to three spaces before a block marker; four makes it code.
    test.each([0, 1, 2, 3])("a heading indented by %i spaces is a heading", (n) => {
      expect(renderMarkdown(`${" ".repeat(n)}### Title`)).toContain("<h4>Title</h4>");
    });

    test.each([0, 1, 2, 3])("a list indented by %i spaces is a list", (n) => {
      expect(renderMarkdown(`${" ".repeat(n)}- item`)).toContain("<li>item</li>");
    });

    test("a table indented by two spaces is a table", () => {
      const html = renderMarkdown("  | a | b |\n  | --- | ---: |\n  | 1 | 2 |");
      expect(html).toContain("<table>");
      expect(html).toContain('<th style="text-align:left">a</th>');
      expect(html).toContain('<th style="text-align:right">b</th>');
      expect(html).toContain('<td style="text-align:right">2</td>');
    });

    test("an indented blockquote and rule render", () => {
      expect(renderMarkdown("  > quoted")).toContain("<blockquote>quoted</blockquote>");
      expect(renderMarkdown("  ---")).toContain("<hr/>");
    });
  });

  describe("blocks", () => {
    test("heading levels map h1..h4 → h2..h5", () => {
      expect(renderMarkdown("# a")).toContain("<h2>a</h2>");
      expect(renderMarkdown("## a")).toContain("<h3>a</h3>");
      expect(renderMarkdown("### a")).toContain("<h4>a</h4>");
      expect(renderMarkdown("#### a")).toContain("<h5>a</h5>");
    });

    test("`###` is not eaten by the `#` rule", () => {
      expect(renderMarkdown("### a")).not.toContain("<h2>");
    });

    test("images render", () => {
      expect(renderMarkdown("![alt](https://x/y.png)")).toContain(
        '<img src="https://x/y.png" alt="alt"/>',
      );
    });

    test("all three bullet markers work", () => {
      for (const b of ["-", "*", "+"]) {
        expect(renderMarkdown(`${b} item`), b).toContain("<li>item</li>");
      }
    });

    test("ordered lists render", () => {
      const html = renderMarkdown("1. one\n2. two");
      expect(html).toContain("<ol>");
      expect(html).toContain("<li>one</li>");
    });

    test("all three horizontal-rule spellings work", () => {
      for (const r of ["---", "***", "___"]) expect(renderMarkdown(r), r).toContain("<hr/>");
    });

    test("fenced code survives inline transforms", () => {
      const html = renderMarkdown("```js\nconst a = **not bold**;\n```");
      expect(html).toContain("<pre><code>const a = **not bold**;</code></pre>");
    });

    test("task lists render", () => {
      expect(renderMarkdown("- [x] done")).toContain('class="wn-task done"');
      expect(renderMarkdown("- [ ] todo")).toContain('class="wn-task"');
    });
  });

  /** The output is injected as raw HTML, so escaping is the whole safety story. */
  describe("escaping", () => {
    test("markup in the release body cannot survive", () => {
      const html = renderMarkdown('<img src=x onerror="alert(1)">');
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img");
    });

    test("a script tag is inert", () => {
      const html = renderMarkdown("<script>alert(1)</script>");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("ampersands are escaped once", () => {
      expect(renderMarkdown("a & b")).toContain("a &amp; b");
    });
  });
});
