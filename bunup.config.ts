import { defineConfig } from "bunup";

// `@tikoci/centrs` ships raw TypeScript (Bun-native). Keep it external so bunup
// doesn't inline its namespace re-export (which it mis-bundles); Bun resolves the
// package from node_modules at runtime, and npm/bunx install it alongside us.
const external = ["@tikoci/centrs"];

export default defineConfig([
  {
    name: "library",
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    target: "bun",
    dts: true,
    clean: true,
    external,
  },
  {
    name: "cli",
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    target: "bun",
    dts: false,
    clean: false,
    external,
  },
]);
