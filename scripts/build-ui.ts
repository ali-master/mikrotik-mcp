/**
 * Build the MCP App views into single self-contained HTML files.
 *
 * 1. `vp build -c ui/vite.config.ts` (vite-plus) bundles each `ui/<id>/index.html`
 *    entry into `dist/ui-build/<id>/index.html` + hashed JS/CSS assets.
 * 2. We inline those assets into the HTML and write `dist/ui/<id>.html`.
 *
 * A single self-contained file is required because the host renders the view in
 * a sandboxed iframe that can't fetch sibling assets. The intermediate
 * `dist/ui-build` is removed afterwards so only the final views ship.
 *
 * Run via `bun run build:ui`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROJECT_ROOT } from "../src/paths";

const log = (msg: string): void => void process.stdout.write(`${msg}\n`);

const BUILD_DIR = join(PROJECT_ROOT, "dist", "ui-build");
const OUT_DIR = join(PROJECT_ROOT, "dist", "ui");

/** Inline `<script src>` / `<link rel=stylesheet>` referenced by an HTML file. */
function inline(htmlPath: string): string {
  const htmlDir = dirname(htmlPath);
  let html = readFileSync(htmlPath, "utf8");

  html = html.replace(
    /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
    (_m: string, src: string) => {
      // Escape any literal `</script>` in the bundle so it can't close the tag.
      const js = readFileSync(resolve(htmlDir, src), "utf8").replace(/<\/script>/gi, "<\\/script>");
      return `<script type="module">\n${js}\n</script>`;
    },
  );

  html = html.replace(
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
    (_m: string, href: string) => {
      const css = readFileSync(resolve(htmlDir, href), "utf8");
      return `<style>\n${css}\n</style>`;
    },
  );

  return html;
}

function main(): void {
  log("• Building MCP App views (vp build)…");
  const res = spawnSync("bunx", ["vp", "build", "-c", "ui/vite.config.ts", "--logLevel", "warn"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    console.error("✗ vp build failed");
    process.exit(res.status ?? 1);
  }

  if (!existsSync(BUILD_DIR)) {
    console.error(`✗ expected build output at ${BUILD_DIR}`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  let count = 0;
  for (const entry of readdirSync(BUILD_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // skip the `assets/` siblings handled via inline
    const htmlPath = join(BUILD_DIR, entry.name, "index.html");
    if (!existsSync(htmlPath)) continue;
    const out = join(OUT_DIR, `${entry.name}.html`);
    writeFileSync(out, inline(htmlPath));
    const kb = (readFileSync(out).byteLength / 1024).toFixed(1);
    log(`  ✓ dist/ui/${entry.name}.html (${kb} kB, self-contained)`);
    count++;
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });
  log(`✓ Built ${count} MCP App view${count === 1 ? "" : "s"}.`);
}

main();
