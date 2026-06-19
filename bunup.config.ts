import { defineConfig } from "bunup";

// This is a Bun application: it uses bun:sqlite and other Bun-native APIs, so
// every artifact targets the Bun runtime. paths.ts resolves the prompts/
// schemas/ config/ data dirs from import.meta.url, so the bundled CLI in
// dist/ still finds them at the project root (dist/.. === root).
export default defineConfig([
  {
    name: "library",
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    target: "bun",
    dts: true,
    clean: true,
  },
  {
    name: "cli",
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    target: "bun",
    dts: false,
    clean: false,
  },
]);
