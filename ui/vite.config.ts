import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/**
 * Build config for the MCP App views (run via `vp build -c ui/vite.config.ts`,
 * the vite-plus toolchain — no standalone Vite). Each view is a separate HTML
 * entry under `ui/<id>/index.html`. Output lands in `dist/ui-build/`, then
 * `scripts/build-ui.ts` inlines each into a single self-contained
 * `dist/ui/<id>.html` (required for the sandboxed iframe).
 *
 * `base: "./"` keeps asset references relative so the inliner can resolve them;
 * a huge `assetsInlineLimit` + `cssCodeSplit: false` push as much as possible
 * inline already.
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  build: {
    outDir: resolve(here, "../dist/ui-build"),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      // MCP App views (ext-apps). The React observability dashboard is built
      // separately (ui/vite.observability.config.ts) as a single self-contained
      // bundle, because a multi-entry build extracts a shared runtime chunk that
      // can't be inlined into one HTML file.
      input: {
        dashboard: resolve(here, "dashboard/index.html"),
        records: resolve(here, "records/index.html"),
        interfaces: resolve(here, "interfaces/index.html"),
        firewall: resolve(here, "firewall/index.html"),
        "firewall-audit": resolve(here, "firewall-audit/index.html"),
        "connected-devices": resolve(here, "connected-devices/index.html"),
      },
    },
  },
});
