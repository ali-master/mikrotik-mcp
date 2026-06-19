import { defineConfig } from "bunup";

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
