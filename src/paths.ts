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

const ROOT = dirname(import.meta.dir);

export const PROMPTS_DIR = join(ROOT, "prompts");
export const SCHEMAS_DIR = join(ROOT, "schemas");
export const PROJECT_ROOT = ROOT;
