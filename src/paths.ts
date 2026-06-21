/**
 * Resolves the on-disk asset directories (prompts/, schemas/) relative to the
 * project root, regardless of whether the code runs from `src/` (dev) or the
 * bundled `dist/` (published package).
 *
 * `import.meta.dir` points at the directory of *this* file. In dev that is
 * `<root>/src`; in the published build it is `<root>/dist`. Either way the
 * parent directory is the project root, where `prompts/` and `schemas/` live
 * (they are shipped via the `files` array in package.json).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Directory of *this* file, resolved across runtimes: `import.meta.dir` (Bun),
// `import.meta.dirname` (Node ≥ 20.11), then a portable `import.meta.url`
// fallback (used by the Vitest/Node test runner). In dev this is `<root>/src`;
// in the published build it is `<root>/dist` — the parent is the project root.
const meta = import.meta as ImportMeta & { dir?: string; dirname?: string };
const HERE = meta.dir ?? meta.dirname ?? dirname(fileURLToPath(import.meta.url));

const ROOT = dirname(HERE);

export const PROMPTS_DIR = join(ROOT, "prompts");
export const SCHEMAS_DIR = join(ROOT, "schemas");
export const PROJECT_ROOT = ROOT;

/**
 * Built MCP App views (single-file HTML). The UI build (`vp build`) always
 * emits here, and the same path resolves whether the server runs from `src/`
 * (dev) or the bundled `dist/` (published package).
 */
export const UI_DIST_DIR = join(ROOT, "dist", "ui");
