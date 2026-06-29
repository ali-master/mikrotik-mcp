/**
 * Guards asset-path resolution. The published bundle code-splits into
 * `dist/shared/`, so `import.meta.dir` is NOT a fixed depth below the package
 * root; `paths.ts` must resolve the root by finding `package.json`, not by
 * assuming "parent of here". This pins that the resolved root is the real
 * package root (the one holding package.json + prompts/ + schemas/).
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { PROJECT_ROOT, PROMPTS_DIR, SCHEMAS_DIR, UI_DIST_DIR } from "../src/paths";

describe("asset paths", () => {
  test("PROJECT_ROOT is the package root (has package.json)", () => {
    expect(existsSync(join(PROJECT_ROOT, "package.json"))).toBe(true);
  });

  test("prompts/ and schemas/ resolve to real shipped directories", () => {
    expect(basename(PROMPTS_DIR)).toBe("prompts");
    expect(basename(SCHEMAS_DIR)).toBe("schemas");
    expect(existsSync(PROMPTS_DIR)).toBe(true);
    expect(existsSync(SCHEMAS_DIR)).toBe(true);
  });

  test("UI dist dir is <root>/dist/ui (never doubled to dist/dist/ui)", () => {
    expect(UI_DIST_DIR).toBe(join(PROJECT_ROOT, "dist", "ui"));
    expect(UI_DIST_DIR).not.toContain(join("dist", "dist"));
  });
});
