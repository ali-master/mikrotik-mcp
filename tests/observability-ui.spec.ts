/**
 * Static checks on the observability dashboard's source.
 *
 * The dashboard ships as ONE self-contained HTML file (`dist/ui/observability.html`),
 * inlined by `scripts/build-ui.ts`. These tests can't build it — the suite is
 * offline and `bun run build:ui` is minutes long — so they guard the source-level
 * invariants that a build would otherwise fail on, or worse, silently degrade:
 *
 *   1. No `styles.css`. The 4,469-line hand-rolled stylesheet was deleted when the
 *      dashboard moved to shadcn/ui; a stray import would resurrect a dead file.
 *   2. No hardcoded colours in the React source. The dashboard now has a light
 *      theme, and a literal hex silently breaks it on one of the two themes —
 *      exactly the class of bug that a typecheck and a build both wave through.
 *   3. `index.html` declares no external stylesheet, because the inliner reads
 *      every stylesheet href off disk and would throw on a remote URL.
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { PROJECT_ROOT } from "../src/paths";

const UI_DIR = join(PROJECT_ROOT, "ui", "observability");

/** The dashboard's own React source — not the vendored shadcn primitives. */
const sourceFiles: [string, string][] = readdirSync(UI_DIR)
  .filter((f: string) => f.endsWith(".tsx") || f.endsWith(".ts"))
  .map((f: string) => [f, readFileSync(join(UI_DIR, f), "utf8")]);

describe("observability dashboard", () => {
  test("has React source to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(15);
  });

  test("no module imports the deleted styles.css", () => {
    for (const [name, src] of sourceFiles) {
      expect(src, `${name} imports the deleted styles.css`).not.toContain('"./styles.css"');
    }
  });

  test("tailwind.css is the single stylesheet entry, and pulls in the SVG island", () => {
    const main = readFileSync(join(UI_DIR, "main.tsx"), "utf8");
    expect(main).toContain('import "./tailwind.css"');

    const tw = readFileSync(join(UI_DIR, "tailwind.css"), "utf8");
    expect(tw).toContain('@import "tailwindcss"'); // Preflight, which shadcn assumes
    expect(tw).toContain('@import "./viz.css"'); // keyframes/filters utilities can't express
  });

  test("defines both colour schemes", () => {
    const tw = readFileSync(join(UI_DIR, "tailwind.css"), "utf8");
    expect(tw).toMatch(/^:root\s*\{/m);
    expect(tw).toMatch(/^\.dark\s*\{/m);
    // `--accent` is shadcn's muted hover surface, NOT the brand colour. An earlier
    // revision aliased it to --page-accent, lighting up every hover state.
    expect(tw).not.toMatch(/--accent:\s*var\(--page-accent/);
    expect(tw).toMatch(/--brand:\s*var\(--page-accent/);
  });

  /**
   * Colours must come from tokens so both themes resolve them. SVG attributes and
   * inline styles can't take a utility class, so `var(--token)` is the escape
   * hatch there — a literal hex is not.
   */
  test("no hardcoded hex colours in the dashboard source", () => {
    const HEX = /["'`]#[0-9a-fA-F]{3,8}["'`]/g;
    const offenders: string[] = [];
    for (const [name, src] of sourceFiles) {
      for (const m of src.matchAll(HEX)) offenders.push(`${name}: ${m[0]}`);
    }
    expect(offenders, `use a var(--token) instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("index.html declares no external stylesheet (the inliner reads hrefs off disk)", () => {
    const html = readFileSync(join(UI_DIR, "index.html"), "utf8");
    expect(html).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    // Dark stays the default when no preference is stored.
    expect(html).toContain('class="dark"');
  });

  /** GSAP's ScrollTrigger queries `.reveal`; it is a behavioural hook, not styling. */
  test("the GSAP reveal hook survives", () => {
    const hooks = readFileSync(join(UI_DIR, "hooks.ts"), "utf8");
    expect(hooks).toContain(".reveal");
    const tw = readFileSync(join(UI_DIR, "tailwind.css"), "utf8");
    expect(tw).toContain(".js-motion .reveal");
  });
});
