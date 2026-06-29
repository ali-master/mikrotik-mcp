/**
 * Resolves the on-disk asset directories (prompts/, schemas/, dist/ui/) for both
 * dev (running from `src/`) and the published package (running from the bundled
 * `dist/`), regardless of how the bundler lays the output out.
 *
 * `import.meta.dir` points at the directory of *this* module at runtime. That is
 * NOT a fixed depth: in dev it is `<root>/src`, but in the published build bunup
 * code-splits the bundle into `<root>/dist/shared/`, so a naive "parent of here"
 * lands on `<root>/dist` instead of `<root>` and every asset path is off by one
 * (the dashboard then can't find `dist/ui/observability.html` and shows the
 * "UI hasn't been built yet" placeholder). So instead of assuming a depth, we
 * walk UP from here to the nearest directory containing `package.json` — the
 * package root, where `prompts/`, `schemas/` and `dist/` all live — which is
 * correct whether the code runs from `src/`, `dist/`, or `dist/shared/`.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Directory of *this* file, resolved across runtimes: `import.meta.dir` (Bun),
// `import.meta.dirname` (Node ≥ 20.11), then a portable `import.meta.url`
// fallback (used by the Vitest/Node test runner).
const meta = import.meta as ImportMeta & { dir?: string; dirname?: string };
const HERE = meta.dir ?? meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` to the nearest ancestor that holds a `package.json` —
 * the package/project root. Falls back to the parent of `start` (the previous
 * behaviour) if none is found, so resolution never throws.
 */
function findRoot(start: string): string {
  let dir = start;
  // A generous cap guards against a filesystem with no package.json above us.
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return dirname(start);
}

const ROOT = findRoot(HERE);

export const PROMPTS_DIR = join(ROOT, "prompts");
export const SCHEMAS_DIR = join(ROOT, "schemas");
export const PROJECT_ROOT = ROOT;

/**
 * Built MCP App views (single-file HTML). The UI build (`vp build`) always
 * emits here, and `ROOT` resolves to the package root whether the server runs
 * from `src/` (dev) or the bundled `dist/` (published package).
 */
export const UI_DIST_DIR = join(ROOT, "dist", "ui");
