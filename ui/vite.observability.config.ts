import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/**
 * Dedicated build for the React observability dashboard.
 *
 * It is a *single-input* build with `inlineDynamicImports: true`, so the whole
 * app (React + components) emits as one JS chunk with no shared runtime chunk —
 * which `scripts/build-ui.ts` can then inline into a single self-contained
 * `dist/ui/observability.html`. (The MCP App views are built separately in
 * `ui/vite.config.ts`; a multi-entry build would split out a runtime chunk that
 * can't be inlined.)
 *
 * `emptyOutDir: false` so this build appends to `dist/ui-build` alongside the
 * MCP-view output rather than wiping it.
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  build: {
    outDir: resolve(here, "../dist/ui-build"),
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { observability: resolve(here, "observability/index.html") },
      output: { inlineDynamicImports: true },
    },
  },
});
